package expo.modules.t3voicetranscription

import android.content.res.Resources
import android.os.Build
import android.os.SystemClock
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.Locale
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class T3VoiceTranscriptionModule : Module() {
  private val lifetime = SupervisorJob()
  private val scope = CoroutineScope(lifetime + Dispatchers.IO)
  private val lock = Any()
  private var operation: Pair<Int, Job>? = null
  private var parakeet: ParakeetVoiceTranscriber? = null

  @Volatile private var diagnostics: Map<String, Any> = emptyMap()

  override fun definition() = ModuleDefinition {
    Name("T3VoiceTranscription")

    Function("isAvailable") { Build.VERSION.SDK_INT >= Build.VERSION_CODES.S }
    Function("isParakeetAvailable") {
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
        Resources.getSystem().configuration.locales[0].language == "en"
    }
    AsyncFunction("getDiagnostics") { diagnostics.takeIf { it.isNotEmpty() } }

    AsyncFunction("checkAvailability").Coroutine<Boolean> {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
        false
      } else {
        withContext(Dispatchers.IO) {
          val context = requireNotNull(appContext.reactContext)
          val locale = Resources.getSystem().configuration.locales[0]
          isGoogleVoiceTranscriptionSupported { MlKitSpeechClient(context, locale, it) }
        }
      }
    }

    AsyncFunction("prepare") { id: Int, promise: Promise ->
      prepareGoogle(id, promise)
    }

    AsyncFunction("prepareParakeet") { id: Int, promise: Promise ->
      prepareParakeet(id, promise)
    }

    AsyncFunction("transcribe") {
        id: Int,
        uri: String,
        language: String,
        mode: Int,
        promise: Promise
      ->
      transcribe(id, uri, language, mode, promise)
    }

    AsyncFunction("cancel") { id: Int, promise: Promise ->
      scope.launch {
        val job = synchronized(lock) { operation?.takeIf { it.first == id }?.second }
        job?.cancelAndJoin()
        promise.resolve(null)
      }
    }

    OnDestroy {
      // Wait for synchronous native inference to leave before releasing its model.
      lifetime.invokeOnCompletion {
        runCatching { parakeet?.close() }
        parakeet = null
      }
      scope.cancel()
    }
  }

  private fun prepareGoogle(id: Int, promise: Promise) = runOperation(
    id,
    promise,
    "preparation-failed"
  ) {
    val started = SystemClock.elapsedRealtimeNanos()
    diagnostics = mapOf("engine" to "google", "status" to "preparing")
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
      throw VoiceTranscriptionException(
        "unavailable",
        "Voice transcription requires Android 12 or later."
      )
    }
    val context = requireNotNull(appContext.reactContext)
    val locale = Resources.getSystem().configuration.locales[0]
    val mode = prepareGoogleVoiceTranscription { MlKitSpeechClient(context, locale, it) }
    diagnostics =
      mapOf("engine" to "google", "status" to "ready", "preparationMs" to elapsedMs(started))
    mapOf("locale" to locale.toLanguageTag(), "mode" to mode)
  }

  private fun prepareParakeet(id: Int, promise: Promise) = runOperation(
    id,
    promise,
    "preparation-failed"
  ) {
    val started = SystemClock.elapsedRealtimeNanos()
    diagnostics = mapOf("engine" to "parakeet", "status" to "preparing")
    val locale = Resources.getSystem().configuration.locales[0]
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S || locale.language != "en") {
      throw VoiceTranscriptionException(
        "unsupported-locale",
        "Parakeet dictation supports English on Android 12 or later."
      )
    }
    parakeetClient().prepare()
    diagnostics =
      mapOf("engine" to "parakeet", "status" to "ready", "preparationMs" to elapsedMs(started))
    mapOf("locale" to locale.toLanguageTag(), "mode" to ParakeetVoiceTranscriber.MODE)
  }

  private fun transcribe(id: Int, uri: String, language: String, mode: Int, promise: Promise) =
    runOperation(id, promise, "transcription-failed") {
      val started = SystemClock.elapsedRealtimeNanos()
      val preparation = diagnostics["preparationMs"]
      val context = requireNotNull(appContext.reactContext)
      val text = if (mode == ParakeetVoiceTranscriber.MODE) {
        val result = parakeetClient().transcribe(uri)
        diagnostics = mapOf(
          "engine" to "parakeet",
          "status" to "complete",
          "decodeMs" to result.decodeMs,
          "inferenceMs" to result.inferenceMs,
          "audioSampleRateHz" to result.audioSampleRateHz,
          "audioDurationSeconds" to result.audioDurationSeconds,
          "totalMs" to elapsedMs(started)
        )
        result.text
      } else {
        val result = MlKitSpeechClient(context, Locale.forLanguageTag(language), mode).use {
          it.transcribe(uri)
        }
        diagnostics =
          mapOf("engine" to "google", "status" to "complete", "totalMs" to elapsedMs(started))
        result
      }
      if (preparation != null) diagnostics = diagnostics + ("preparationMs" to preparation)
      text
    }

  private fun parakeetClient(): ParakeetVoiceTranscriber = parakeet
    ?: ParakeetVoiceTranscriber(requireNotNull(appContext.reactContext)).also { parakeet = it }

  private fun elapsedMs(start: Long) = (SystemClock.elapsedRealtimeNanos() - start) / 1_000_000.0

  private fun runOperation(
    id: Int,
    promise: Promise,
    errorCode: String,
    block: suspend () -> Any?
  ) {
    var result: Result<Any?>? = null
    val job = scope.launch(start = CoroutineStart.LAZY) {
      result = runCatching { block() }
    }
    synchronized(lock) {
      if (operation != null) {
        job.cancel()
        promise.reject(errorCode, "Another voice transcription is already active.", null)
        return
      }
      operation = id to job
    }
    job.invokeOnCompletion { cause ->
      synchronized(lock) { if (operation?.first == id) operation = null }
      val outcome = cause?.let { Result.failure<Any?>(it) } ?: result
        ?: Result.failure(CancellationException("Voice transcription was cancelled."))
      outcome.fold(
        onSuccess = { promise.resolve(it) },
        onFailure = { error ->
          diagnostics =
            diagnostics + ("status" to if (error is CancellationException) "cancelled" else "error")
          val code = when (error) {
            is CancellationException -> "cancelled"
            is VoiceTranscriptionException -> error.code
            else -> errorCode
          }
          promise.reject(code, error.message, error)
        }
      )
    }
    job.start()
  }
}
