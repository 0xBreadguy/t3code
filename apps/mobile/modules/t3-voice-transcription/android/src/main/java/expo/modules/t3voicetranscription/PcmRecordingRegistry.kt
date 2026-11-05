package expo.modules.t3voicetranscription

import java.io.File
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext

internal class PcmRecordingRegistry(
  private val createSession: (Int) -> PcmRecordingSession
) {
  private class Entry(val id: Int) {
    val ready = CompletableDeferred<Unit>()

    @Volatile var session: PcmRecordingSession? = null

    @Volatile var invalidated = false
  }

  private val lock = Any()
  private val entries = mutableMapOf<Int, Entry>()
  private val files = mutableSetOf<File>()
  private var current: Entry? = null
  private var newestId = -1
  private var releasedThrough = -1
  private var background = false
  private var closed = false

  suspend fun prepare(id: Int): PcmRecordingState {
    val entry = Entry(id)
    val previous = synchronized(lock) {
      check(!closed && !background) { "Microphone recording requires an active app." }
      check(id > newestId && id > releasedThrough) { "This microphone recording was released." }
      newestId = id
      current?.also { it.invalidated = true }.also {
        current = entry
        entries[id] = entry
      }
    }
    var prepared = false
    try {
      if (previous != null) discard(previous)
      checkActive(entry)
      val session = createSession(id)
      entry.session = session
      currentCoroutineContext().ensureActive()
      checkActive(entry)
      return session.status().also { prepared = true }
    } finally {
      if (!prepared) entry.invalidated = true
      try {
        if (entry.invalidated || entry.session == null) {
          withContext(NonCancellable) { entry.session?.dispose() }
          synchronized(lock) {
            entries.remove(id)
            if (current === entry) current = null
          }
        }
      } finally {
        entry.ready.complete(Unit)
      }
    }
  }

  fun start(id: Int, seconds: Double) = requireSession(id).start(seconds)

  suspend fun stop(id: Int): PcmRecordingState = requireSession(id).stop()

  fun status(id: Int): PcmRecordingState? = synchronized(lock) {
    current?.takeIf { it.id == id && !it.invalidated }?.session?.status()
  }

  fun setInput(id: Int, uid: String) = requireSession(id).setInput(uid)

  suspend fun release(id: Int) {
    val entry = synchronized(lock) {
      releasedThrough = maxOf(releasedThrough, id)
      entries[id]?.also {
        it.invalidated = true
        if (current === it) current = null
        it.session?.interrupt("Microphone recording was cancelled.")
      }
    }
    if (entry != null) discard(entry)
  }

  fun setBackground(value: Boolean) {
    synchronized(lock) {
      background = value
      if (value) {
        current?.also {
          it.invalidated = true
          it.session?.interrupt(
            "Microphone recording was interrupted when the app left the foreground."
          )
        }
      }
    }
  }

  fun close() {
    synchronized(lock) {
      closed = true
      entries.values.forEach {
        it.invalidated = true
        it.session?.interrupt("Microphone recording was interrupted because the app closed.")
      }
    }
  }

  suspend fun releaseInterrupted() {
    val interrupted = synchronized(lock) { entries.values.filter { it.invalidated } }
    interrupted.forEach { discard(it) }
  }

  fun ownFile(file: File) {
    synchronized(lock) { files.add(file) }
  }

  fun deleteOrphanFiles() {
    synchronized(lock) {
      files.forEach { it.delete() }
      files.clear()
    }
  }

  private fun requireSession(id: Int): PcmRecordingSession = synchronized(lock) {
    check(!closed && !background) { "Microphone recording requires an active app." }
    checkNotNull(current?.takeIf { it.id == id && !it.invalidated }?.session) {
      "This microphone recording is no longer available."
    }
  }

  private fun checkActive(entry: Entry) = synchronized(lock) {
    check(!closed && !background && current === entry && !entry.invalidated) {
      "Microphone preparation was cancelled."
    }
  }

  private suspend fun discard(entry: Entry) = withContext(NonCancellable) {
    entry.session?.interrupt("Microphone recording was cancelled.")
    entry.ready.await()
    entry.session?.dispose()
    synchronized(lock) {
      entries.remove(entry.id)
      if (current === entry) current = null
    }
  }
}
