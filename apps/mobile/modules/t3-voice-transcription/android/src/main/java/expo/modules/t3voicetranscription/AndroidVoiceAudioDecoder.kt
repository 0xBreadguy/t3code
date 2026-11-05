package expo.modules.t3voicetranscription

import android.content.Context
import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.net.Uri
import android.os.Build
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout

internal data class DecodedVoiceAudio(
  val samples: FloatArray,
  val sampleRate: Int,
  val sourceMime: String = MediaFormat.MIMETYPE_AUDIO_RAW
)

// AAC priming/padding can slightly outlast the five-minute recording timer.
private const val VOICE_DECODE_MAX_SECONDS = 301
private const val VOICE_DECODE_MAX_SAMPLES = 16 * 1024 * 1024
private const val VOICE_DECODE_DEQUEUE_TIMEOUT_US = 10_000L
private const val VOICE_DECODE_MAX_RAW_BUFFER = 1024 * 1024

internal suspend fun decodeVoiceAudio(context: Context, uri: String): DecodedVoiceAudio =
  withContext(Dispatchers.IO) {
    try {
      withTimeout(60_000) { decodeLocalVoiceAudio(context, uri) }
    } catch (error: TimeoutCancellationException) {
      currentCoroutineContext().ensureActive()
      throw VoiceTranscriptionException("transcription-failed", "Local audio decoding timed out.")
        .also { it.initCause(error) }
    }
  }

private suspend fun decodeLocalVoiceAudio(context: Context, uri: String): DecodedVoiceAudio {
  currentCoroutineContext().ensureActive()
  val source = Uri.parse(uri)
  require(source.scheme == "file" || source.scheme == "content") {
    "Voice audio must be a local file."
  }
  val extractor = MediaExtractor()
  try {
    extractor.setDataSource(context, source, null)
    val track = (0 until extractor.trackCount).firstOrNull { index ->
      extractor.getTrackFormat(index).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true
    } ?: throw IllegalArgumentException("No audio track was found.")
    extractor.selectTrack(track)
    val inputFormat = extractor.getTrackFormat(track)
    if (inputFormat.containsKey(MediaFormat.KEY_DURATION)) {
      require(
        inputFormat.getLong(MediaFormat.KEY_DURATION) <= VOICE_DECODE_MAX_SECONDS * 1_000_000L
      ) {
        "Voice recording exceeds the five-minute limit."
      }
    }
    val mime = requireNotNull(inputFormat.getString(MediaFormat.KEY_MIME))
    if (mime == MediaFormat.MIMETYPE_AUDIO_RAW) {
      val output = VoicePcmAccumulator()
      output.setFormat(inputFormat.voicePcmFormat())
      readRawVoiceAudio(extractor, output)
      return output.finish()
    }
    return decodeCompressedVoiceAudio(extractor, mime, inputFormat).copy(sourceMime = mime)
  } finally {
    runCatching { extractor.release() }
  }
}

private suspend fun decodeCompressedVoiceAudio(
  extractor: MediaExtractor,
  mime: String,
  format: MediaFormat
): DecodedVoiceAudio {
  val codec = MediaCodec.createDecoderByType(mime)
  var started = false
  try {
    codec.configure(format, null, null, 0)
    codec.start()
    started = true
    return drainVoiceDecoder(extractor, codec)
  } finally {
    if (started) runCatching { codec.stop() }
    runCatching { codec.release() }
  }
}

private suspend fun drainVoiceDecoder(
  extractor: MediaExtractor,
  codec: MediaCodec
): DecodedVoiceAudio {
  val output = VoicePcmAccumulator()
  val info = MediaCodec.BufferInfo()
  var inputEnded = false
  var outputEnded = false
  while (!outputEnded) {
    currentCoroutineContext().ensureActive()
    if (!inputEnded) inputEnded = queueVoiceDecoderInput(extractor, codec)
    val index = codec.dequeueOutputBuffer(info, VOICE_DECODE_DEQUEUE_TIMEOUT_US)
    when {
      index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> output.setFormat(
        codec.outputFormat.voicePcmFormat()
      )
      index >= 0 -> {
        try {
          appendVoiceDecoderOutput(codec, index, info, output)
          outputEnded = info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0
        } finally {
          codec.releaseOutputBuffer(index, false)
        }
      }
    }
  }
  currentCoroutineContext().ensureActive()
  return output.finish()
}

private fun queueVoiceDecoderInput(extractor: MediaExtractor, codec: MediaCodec): Boolean {
  val index = codec.dequeueInputBuffer(VOICE_DECODE_DEQUEUE_TIMEOUT_US)
  if (index < 0) return false
  val buffer = requireNotNull(codec.getInputBuffer(index)) { "Missing audio decoder input buffer." }
  buffer.clear()
  val sampleSize = voiceSampleSize(extractor)
  val size = if (sampleSize < 0) {
    -1
  } else {
    require(sampleSize <= buffer.capacity()) { "Audio access unit is too large." }
    require(extractor.sampleFlags and MediaExtractor.SAMPLE_FLAG_ENCRYPTED == 0) {
      "Encrypted voice recordings are not supported."
    }
    extractor.readSampleData(buffer, 0)
  }
  return if (size < 0) {
    codec.queueInputBuffer(index, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
    true
  } else {
    codec.queueInputBuffer(index, 0, size, extractor.sampleTime.coerceAtLeast(0), 0)
    extractor.advance()
    false
  }
}

private fun appendVoiceDecoderOutput(
  codec: MediaCodec,
  index: Int,
  info: MediaCodec.BufferInfo,
  output: VoicePcmAccumulator
) {
  if (info.size <= 0 || info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0) return
  output.setFormat(codec.getOutputFormat(index).voicePcmFormat())
  val buffer =
    requireNotNull(codec.getOutputBuffer(index)) { "Missing audio decoder output buffer." }
  require(info.offset >= 0 && info.size <= buffer.capacity() - info.offset) {
    "Invalid PCM output range."
  }
  val data = buffer.duplicate().apply {
    clear()
    position(info.offset)
    limit(info.offset + info.size)
  }
  output.append(data)
}

private suspend fun readRawVoiceAudio(extractor: MediaExtractor, output: VoicePcmAccumulator) {
  var buffer = ByteBuffer.allocate(64 * 1024)
  while (voiceSampleSize(extractor) >= 0) {
    currentCoroutineContext().ensureActive()
    val size = voiceSampleSize(extractor)
    require(size <= VOICE_DECODE_MAX_RAW_BUFFER) { "PCM input buffer is too large." }
    if (size > buffer.capacity()) buffer = ByteBuffer.allocate(size.toInt())
    buffer.clear()
    val count = extractor.readSampleData(buffer, 0)
    if (count < 0) break
    require(count <= buffer.capacity()) { "Invalid PCM input range." }
    buffer.position(0)
    buffer.limit(count)
    output.append(buffer)
    extractor.advance()
  }
}

private fun voiceSampleSize(extractor: MediaExtractor): Long {
  if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) {
    throw VoiceTranscriptionException(
      "unavailable",
      "Local audio decoding is unavailable on this Android version."
    )
  }
  return extractor.sampleSize
}

private fun MediaFormat.voicePcmFormat() = VoicePcmFormat(
  sampleRate = getInteger(MediaFormat.KEY_SAMPLE_RATE),
  channels = getInteger(MediaFormat.KEY_CHANNEL_COUNT),
  encoding = if (containsKey(MediaFormat.KEY_PCM_ENCODING)) {
    getInteger(MediaFormat.KEY_PCM_ENCODING)
  } else {
    AudioFormat.ENCODING_PCM_16BIT
  }
)

internal data class VoicePcmFormat(val sampleRate: Int, val channels: Int, val encoding: Int) {
  init {
    require(sampleRate in 1..192000) { "Unsupported PCM sample rate: $sampleRate" }
    require(channels in 1..2) { "Voice audio must be mono or stereo." }
    require(
      encoding == AudioFormat.ENCODING_PCM_16BIT || encoding == AudioFormat.ENCODING_PCM_FLOAT
    ) {
      "Voice audio must use PCM16 or PCM float."
    }
  }
  val bytesPerSample: Int get() = if (encoding == AudioFormat.ENCODING_PCM_FLOAT) 4 else 2
  val bytesPerFrame: Int get() = channels * bytesPerSample
}

internal fun decodeVoicePcm(data: ByteBuffer, format: VoicePcmFormat): FloatArray {
  val input = data.duplicate().order(ByteOrder.nativeOrder())
  require(input.remaining() % format.bytesPerFrame == 0) { "Truncated PCM audio frame." }
  return FloatArray(input.remaining() / format.bytesPerFrame) {
    var sum = 0.0
    repeat(format.channels) {
      val sample = if (format.encoding ==
        AudioFormat.ENCODING_PCM_FLOAT
      ) {
        input.float
      } else {
        input.short / 32768f
      }
      require(sample.isFinite()) { "PCM audio contains a nonfinite sample." }
      sum += sample
    }
    (sum / format.channels).toFloat()
  }
}

internal class VoicePcmAccumulator {
  private var format: VoicePcmFormat? = null
  private val chunks = ArrayList<FloatArray>()
  private var sampleCount = 0

  fun setFormat(next: VoicePcmFormat) {
    require(sampleCount == 0 || next == format) { "Audio format changed during decoding." }
    format = next
  }

  fun append(data: ByteBuffer) {
    val current = requireNotNull(format) { "Missing decoded audio format." }
    val nextCount = sampleCount.toLong() + data.remaining() / current.bytesPerFrame
    require(nextCount <= current.sampleRate.toLong() * VOICE_DECODE_MAX_SECONDS) {
      "Voice recording exceeds the five-minute limit."
    }
    require(nextCount <= VOICE_DECODE_MAX_SAMPLES) { "Decoded voice recording is too large." }
    val samples = decodeVoicePcm(data, current)
    if (samples.isNotEmpty()) chunks.add(samples)
    sampleCount += samples.size
  }

  fun finish(): DecodedVoiceAudio {
    val current = requireNotNull(format) { "Missing decoded audio format." }
    require(sampleCount > 0) { "No decoded audio samples were found." }
    val samples = FloatArray(sampleCount)
    var offset = 0
    for (chunk in chunks) {
      chunk.copyInto(samples, offset)
      offset += chunk.size
    }
    chunks.clear()
    sampleCount = 0
    return DecodedVoiceAudio(samples, current.sampleRate)
  }
}
