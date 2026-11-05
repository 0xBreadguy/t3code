package expo.modules.t3voicetranscription

import java.io.File
import kotlin.math.abs
import kotlin.math.log10
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.coroutines.launch

internal interface PcmCaptureInput {
  fun start()
  fun read(samples: ShortArray, count: Int): Int
  fun stop()
  fun close()
  fun setInput(uid: String)
}

internal data class PcmRecordingState(
  val id: Int,
  val uri: String? = null,
  val canRecord: Boolean = true,
  val isRecording: Boolean = false,
  val durationMillis: Double = 0.0,
  val fileSize: Long = WAV_HEADER_BYTES.toLong(),
  val metering: Double = -160.0,
  val isFinished: Boolean = false,
  val hasError: Boolean = false,
  val error: String? = null
) {
  fun toMap(): Map<String, Any?> = mapOf(
    "id" to id,
    "uri" to uri,
    "canRecord" to canRecord,
    "isRecording" to isRecording,
    "durationMillis" to durationMillis,
    "fileSize" to fileSize,
    "metering" to metering,
    "isFinished" to isFinished,
    "hasError" to hasError,
    "error" to error
  )
}

internal class PcmRecordingSession(
  private val id: Int,
  private val file: File,
  private val input: PcmCaptureInput,
  private val scope: CoroutineScope,
  private val onTerminal: (PcmRecordingState) -> Unit,
  private val stopGraceMillis: Long = 250
) {
  private val writer = PcmWaveWriter(file)
  private val lock = Any()
  private val completed = CompletableDeferred<PcmRecordingState>()
  private var started = false
  private var disposed = false
  private var limitFrames = PCM_SAMPLE_RATE.toLong() * PCM_MAX_SECONDS

  @Volatile private var stopping = false

  @Volatile private var interruption: String? = null

  @Volatile private var state = PcmRecordingState(id)

  fun status(): PcmRecordingState = state

  fun start(seconds: Double) = synchronized(lock) {
    check(!disposed && !started) { "This microphone recording cannot be started." }
    require(seconds.isFinite() && seconds > 0) { "Recording duration must be positive." }
    limitFrames = (minOf(seconds, PCM_MAX_SECONDS.toDouble()) * PCM_SAMPLE_RATE)
      .toLong().coerceAtLeast(1)
    runCatching { input.start() }.onFailure { error ->
      started = true
      interruption = error.message ?: "The microphone could not start."
      launchReader()
    }.getOrThrow()
    started = true
    state = state.copy(isRecording = true)
    launchReader()
  }

  fun setInput(uid: String) = synchronized(lock) {
    check(!disposed && !completed.isCompleted) { "The microphone recording is closed." }
    input.setInput(uid)
  }

  suspend fun stop(): PcmRecordingState {
    val wasStarted = synchronized(lock) {
      stopping = true
      started
    }
    if (!wasStarted) return dispose()
    if (withTimeoutOrNull(stopGraceMillis) { completed.await() } == null) input.stop()
    return completed.await()
  }

  fun interrupt(reason: String) = synchronized(lock) {
    if (!completed.isCompleted) {
      interruption = reason
      stopping = true
      input.stop()
    }
  }

  suspend fun dispose(): PcmRecordingState {
    val wasStarted = synchronized(lock) {
      disposed = true
      if (!completed.isCompleted) {
        interruption = interruption ?: "Microphone recording was cancelled."
        stopping = true
        input.stop()
      }
      started
    }
    return withContext(NonCancellable + Dispatchers.IO) {
      if (!wasStarted) finish(interruption)
      completed.await()
    }
  }

  private fun launchReader() {
    // Enter finally before dispatching so module cancellation cannot strand an opened input.
    scope.launch(start = CoroutineStart.UNDISPATCHED) {
      var failure: String? = null
      try {
        runCatching { withContext(Dispatchers.IO) { readAudio() } }.onFailure {
          failure = it.message ?: "The microphone could not capture audio."
        }
      } finally {
        withContext(NonCancellable + Dispatchers.IO) { finish(interruption ?: failure) }
      }
    }
  }

  private fun readAudio() {
    val samples = ShortArray(PCM_READ_FRAMES)
    while (!stopping && interruption == null && writer.frames < limitFrames) {
      val requested = minOf(samples.size.toLong(), limitFrames - writer.frames).toInt()
      val count = input.read(samples, requested)
      if (count <= 0) {
        check(stopping) { "Microphone read failed ($count)." }
        break
      }
      check(count <= requested) { "The microphone returned an invalid sample count." }
      writer.append(samples, count)
      var peak = 0
      repeat(count) { peak = maxOf(peak, abs(samples[it].toInt())) }
      state = state.copy(
        durationMillis = writer.frames * 1000.0 / PCM_SAMPLE_RATE,
        fileSize = WAV_HEADER_BYTES + writer.frames * 2,
        metering = if (peak == 0) -160.0 else 20 * log10(peak / 32768.0)
      )
    }
  }

  private fun finish(failure: String?): PcmRecordingState = synchronized(lock) {
    if (completed.isCompleted) return@synchronized state
    var error = failure
    runCatching {
      input.stop()
      input.close()
      if (error == null) writer.finish()
    }.onFailure {
      error = error ?: it.message ?: "The recording could not be finalized."
    }
    runCatching { input.close() }
    runCatching { writer.discard() }.onFailure {
      error = error ?: "The recording file could not be closed."
    }
    state = state.copy(
      uri = if (writer.finalized && error == null) file.toURI().toString() else null,
      canRecord = false,
      isRecording = false,
      isFinished = error == null && writer.finalized,
      hasError = error != null,
      error = error,
      fileSize = if (writer.finalized) file.length() else 0
    )
    if (started) runCatching { onTerminal(state) }
    completed.complete(state)
    state
  }
}
