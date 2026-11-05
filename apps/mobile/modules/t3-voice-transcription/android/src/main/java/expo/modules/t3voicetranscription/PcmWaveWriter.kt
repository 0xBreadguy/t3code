package expo.modules.t3voicetranscription

import java.io.File
import java.io.RandomAccessFile

internal const val PCM_SAMPLE_RATE = 16_000
internal const val PCM_MAX_SECONDS = 300
internal const val PCM_READ_FRAMES = 640
internal const val WAV_HEADER_BYTES = 44

internal class PcmWaveWriter(private val file: File) {
  private val output = RandomAccessFile(file, "rw")
  private val bytes = ByteArray(PCM_READ_FRAMES * 2)
  private var closed = false
  var frames = 0L
    private set
  var finalized = false
    private set

  init {
    runCatching {
      output.setLength(0)
      output.write(ByteArray(WAV_HEADER_BYTES))
    }.onFailure {
      runCatching { output.close() }
      file.delete()
    }.getOrThrow()
  }

  fun append(samples: ShortArray, count: Int) {
    check(!closed) { "The recording file is already closed." }
    require(count in 0..minOf(samples.size, PCM_READ_FRAMES))
    require(frames + count <= PCM_SAMPLE_RATE.toLong() * PCM_MAX_SECONDS)
    repeat(count) { index ->
      val value = samples[index].toInt()
      bytes[index * 2] = value.toByte()
      bytes[index * 2 + 1] = (value shr 8).toByte()
    }
    output.write(bytes, 0, count * 2)
    frames += count
  }

  fun finish() {
    if (finalized) return
    check(!closed && frames > 0) { "The microphone did not capture any audio." }
    val size = (frames * 2).toInt()
    output.seek(0)
    output.writeBytes("RIFF")
    writeInt(size + 36)
    output.writeBytes("WAVEfmt ")
    writeInt(16)
    writeShort(1)
    writeShort(1)
    writeInt(PCM_SAMPLE_RATE)
    writeInt(PCM_SAMPLE_RATE * 2)
    writeShort(2)
    writeShort(16)
    output.writeBytes("data")
    writeInt(size)
    output.close()
    closed = true
    finalized = true
  }

  fun discard() {
    try {
      if (!closed) output.close()
    } finally {
      closed = true
      if (!finalized) file.delete()
    }
  }

  private fun writeInt(value: Int) {
    repeat(4) { output.write(value ushr (it * 8)) }
  }

  private fun writeShort(value: Int) {
    repeat(2) { output.write(value ushr (it * 8)) }
  }
}
