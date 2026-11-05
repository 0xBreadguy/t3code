package expo.modules.t3voicetranscription

import android.content.Context
import android.os.SystemClock
import com.k2fsa.sherpa.onnx.FeatureConfig
import com.k2fsa.sherpa.onnx.OfflineModelConfig
import com.k2fsa.sherpa.onnx.OfflineRecognizer
import com.k2fsa.sherpa.onnx.OfflineRecognizerConfig
import com.k2fsa.sherpa.onnx.OfflineTransducerModelConfig
import java.io.Closeable
import java.io.File
import java.io.InputStream
import java.io.OutputStream
import java.security.MessageDigest
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import org.json.JSONObject

internal data class ParakeetVoiceResult(
  val text: String,
  val decodeMs: Double,
  val inferenceMs: Double,
  val audioSampleRateHz: Int,
  val audioDurationSeconds: Double,
  val audioSourceMime: String
)

internal class ParakeetVoiceTranscriber(context: Context) : Closeable {
  private val context = context.applicationContext
  private var recognizer: OfflineRecognizer? = null

  suspend fun prepare(): Unit = withContext(Dispatchers.IO) {
    if (recognizer != null) return@withContext
    val directory = prepareModelFiles()
    currentCoroutineContext().ensureActive()
    val created = try {
      OfflineRecognizer(
        config = OfflineRecognizerConfig(
          featConfig = FeatureConfig(sampleRate = 16000, featureDim = 80, dither = 0.0f),
          modelConfig = OfflineModelConfig(
            transducer = OfflineTransducerModelConfig(
              encoder = File(directory, "encoder.int8.onnx").absolutePath,
              decoder = File(directory, "decoder.int8.onnx").absolutePath,
              joiner = File(directory, "joiner.int8.onnx").absolutePath,
            ),
            tokens = File(directory, "tokens.txt").absolutePath,
            numThreads = 2,
            provider = "cpu",
            modelType = "nemo_transducer",
            modelingUnit = "cjkchar",
          ),
          decodingMethod = "greedy_search",
        ),
      )
    } catch (error: LinkageError) {
      throw VoiceTranscriptionException("unavailable", "The local speech runtime could not load.")
        .also { it.initCause(error) }
    }
    try {
      currentCoroutineContext().ensureActive()
      recognizer = created
    } finally {
      if (recognizer !== created) created.release()
    }
  }

  suspend fun transcribe(uri: String): ParakeetVoiceResult = withContext(Dispatchers.IO) {
    prepare()
    val decodeStart = SystemClock.elapsedRealtimeNanos()
    val audio = decodeVoiceAudio(context, uri)
    val decodeMs = elapsedMs(decodeStart)
    currentCoroutineContext().ensureActive()
    val client = requireNotNull(recognizer)
    val inferenceStart = SystemClock.elapsedRealtimeNanos()
    val stream = client.createStream()
    val text = try {
      // Sherpa resamples the decoder's actual sample rate to the model's 16 kHz features.
      stream.acceptWaveform(audio.samples, audio.sampleRate)
      currentCoroutineContext().ensureActive()
      client.decode(stream)
      currentCoroutineContext().ensureActive()
      client.getResult(stream).text
    } finally {
      stream.release()
    }
    ParakeetVoiceResult(
      text.trim(),
      decodeMs,
      elapsedMs(inferenceStart),
      audio.sampleRate,
      audio.samples.size.toDouble() / audio.sampleRate,
      audio.sourceMime
    )
  }

  override fun close() {
    recognizer?.release()
    recognizer = null
  }

  private suspend fun prepareModelFiles(): File {
    val manifest =
      JSONObject(
        context.assets.open("parakeet/MANIFEST.json").bufferedReader().use {
          it.readText()
        }
      )
    require(
      manifest.getString("model") == MODEL && manifest.getString("runtime") == "sherpa-onnx 2.0.1"
    ) {
      "Unexpected local speech model"
    }
    val files = manifest.getJSONArray("files")
    require(files.length() == MODEL_HASHES.size) { "Incomplete local speech model" }
    val directory = File(context.noBackupFilesDir, "voice/parakeet-110m-int8-v1")
    check(directory.isDirectory || directory.mkdirs()) { "Could not prepare local speech storage" }
    val seen = mutableSetOf<String>()
    for (index in 0 until files.length()) {
      currentCoroutineContext().ensureActive()
      val entry = files.getJSONObject(index)
      val name = entry.getString("name")
      val expectedHash = MODEL_HASHES[name]
      require(expectedHash != null && seen.add(name) && entry.getString("sha256") == expectedHash) {
        "Unexpected local speech model file"
      }
      installModelFile(directory, name, entry.getLong("bytes"), expectedHash)
    }
    return directory
  }

  private suspend fun installModelFile(
    directory: File,
    name: String,
    size: Long,
    expectedHash: String
  ) {
    val destination = File(directory, name)
    if (destination.isFile && destination.length() == size &&
      hashFile(destination) == expectedHash
    ) {
      return
    }
    val temporary = File(directory, "$name.tmp")
    try {
      copyModelAsset(name, temporary)
      check(temporary.length() == size && hashFile(temporary) == expectedHash) {
        "Local speech model checksum mismatch"
      }
      check(temporary.renameTo(destination)) { "Could not install local speech model" }
    } finally {
      temporary.delete()
    }
  }

  private suspend fun copyModelAsset(name: String, destination: File) {
    context.assets.open("parakeet/$name").use { input ->
      destination.outputStream().use { output ->
        copyModelStream(input, output)
      }
    }
  }

  private suspend fun copyModelStream(input: InputStream, output: OutputStream) {
    val buffer = ByteArray(64 * 1024)
    while (true) {
      currentCoroutineContext().ensureActive()
      val count = input.read(buffer)
      if (count < 0) break
      output.write(buffer, 0, count)
    }
  }

  private suspend fun hashFile(file: File): String {
    val digest = MessageDigest.getInstance("SHA-256")
    file.inputStream().use { input ->
      val buffer = ByteArray(64 * 1024)
      while (true) {
        currentCoroutineContext().ensureActive()
        val count = input.read(buffer)
        if (count < 0) break
        digest.update(buffer, 0, count)
      }
    }
    return digest.digest().joinToString("") { "%02x".format(it.toInt() and 255) }
  }

  private fun elapsedMs(start: Long) = (SystemClock.elapsedRealtimeNanos() - start) / 1_000_000.0

  companion object {
    const val MODE = -1
    private const val MODEL = "sherpa-onnx-nemo-parakeet_tdt_transducer_110m-en-36000-int8"
    private val MODEL_HASHES = mapOf(
      "encoder.int8.onnx" to "0f35509ddeb9b39002fb077d979a9fe74f06eb0bc4dd5c34f512f82e5111d657",
      "decoder.int8.onnx" to "f7c331c5504c2e593c76ed22b728e3f554af6c4a383dde862e719ced08b1da19",
      "joiner.int8.onnx" to "bf7dff69e9f2cdbe9943d70da358f38b361c115ba0105bae7e908e0d6ec782f6",
      "tokens.txt" to "450e56bd2f036fe5b6aa821865838cc5aa9d8b0106134ce9a9ba0664abe6cd10",
    )
  }
}
