package expo.modules.t3voicetranscription

import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.file.Files
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import kotlin.coroutines.CoroutineContext
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertTrue
import org.junit.Test

class PcmRecordingSessionTest {
  @Test
  fun `stop retains partial read and finalizes before returning`() = runBlocking {
    val file = Files.createTempFile("pcm-tail", ".wav").toFile()
    val input = QueuedPcmInput()
    val terminal = Channel<PcmRecordingState>(Channel.UNLIMITED)
    val session = PcmRecordingSession(1, file, input, this, {
      terminal.trySend(it)
    }, Long.MAX_VALUE)
    try {
      session.start(300.0)
      assertEquals(PCM_READ_FRAMES, input.reads.receive())
      val stopping = async(start = CoroutineStart.UNDISPATCHED) { session.stop() }
      input.responses.put(shortArrayOf(1, -32768, 32767))
      val result = stopping.await()
      assertTrue(result.isFinished)
      assertEquals(3 * 1000.0 / PCM_SAMPLE_RATE, result.durationMillis, 0.0)
      assertEquals(0.0, result.metering, 0.0)
      assertEquals(result, terminal.receive())
      assertEquals(1, input.closeCount.get())
      assertWave(file, 3)
      assertEquals(result, session.stop())
      session.dispose()
      assertTrue(file.exists())
      assertTrue(terminal.tryReceive().isFailure)
      val pcm = file.readBytes().drop(WAV_HEADER_BYTES).map { it.toInt() and 255 }
      assertEquals(listOf(1, 0, 0, 128, 255, 127), pcm)
    } finally {
      session.dispose()
      file.delete()
    }
  }

  @Test
  fun `stuck read is unblocked by stop and its returned tail is retained`() = runBlocking {
    val file = Files.createTempFile("pcm-unblock", ".wav").toFile()
    val input = QueuedPcmInput(shortArrayOf(42))
    val terminal = Channel<PcmRecordingState>(Channel.UNLIMITED)
    val session = PcmRecordingSession(2, file, input, this, { terminal.trySend(it) }, 0)
    try {
      session.start(300.0)
      input.reads.receive()
      val result = session.stop()
      assertTrue(result.isFinished)
      assertWave(file, 1)
      assertEquals(1, input.closeCount.get())
      assertEquals(result, terminal.receive())
    } finally {
      session.dispose()
      file.delete()
    }
  }

  @Test
  fun `cancel unblocks read and deletes partial audio before error event`() = runBlocking {
    val file = Files.createTempFile("pcm-cancel", ".wav").toFile()
    val input = QueuedPcmInput(shortArrayOf(12, 34))
    val caller = Thread.currentThread()
    val reading = CompletableDeferred<Thread>()
    val lifetime = SupervisorJob()
    val captureScope = CoroutineScope(lifetime + Dispatchers.IO)
    val capture = object : PcmCaptureInput by input {
      override fun read(samples: ShortArray, count: Int): Int {
        val thread = Thread.currentThread()
        reading.complete(thread)
        return if (thread === caller) 0 else input.read(samples, count)
      }
    }
    val terminal = Channel<PcmRecordingState>(Channel.UNLIMITED)
    val session = PcmRecordingSession(3, file, capture, captureScope, { terminal.trySend(it) })
    try {
      session.start(300.0)
      assertNotSame(
        "Audio reads must leave the synchronous recording caller.",
        caller,
        reading.await()
      )
      input.reads.receive()
      val result = session.dispose()
      assertTrue(result.hasError)
      assertFalse(result.isFinished)
      assertEquals(null, result.uri)
      assertFalse(file.exists())
      assertEquals(1, input.closeCount.get())
      assertEquals(result, terminal.receive())
      session.dispose()
      assertTrue(terminal.tryReceive().isFailure)
    } finally {
      session.dispose()
      lifetime.cancelAndJoin()
      file.delete()
    }
  }

  @Test
  fun `automatic limit uses exact frame count and caps requests at five minutes`() = runBlocking {
    val file = Files.createTempFile("pcm-limit", ".wav").toFile()
    val terminal = Channel<PcmRecordingState>(Channel.UNLIMITED)
    val input = object : PcmCaptureInput {
      override fun start() = Unit
      override fun read(samples: ShortArray, count: Int): Int = count
      override fun stop() = Unit
      override fun close() = Unit
      override fun setInput(uid: String) = Unit
    }
    val session = PcmRecordingSession(4, file, input, this, { terminal.trySend(it) })
    try {
      session.start(600.0)
      val result = terminal.receive()
      assertTrue(result.isFinished)
      assertEquals(300_000.0, result.durationMillis, 0.0)
      assertEquals(-160.0, result.metering, 0.0)
      assertWave(file, PCM_SAMPLE_RATE * PCM_MAX_SECONDS)
      assertEquals(result, session.stop())
    } finally {
      session.dispose()
      file.delete()
    }
  }

  @Test
  fun `read error releases hardware and never returns a partial WAV`() = runBlocking {
    val file = Files.createTempFile("pcm-error", ".wav").toFile()
    val input = QueuedPcmInput()
    val terminal = Channel<PcmRecordingState>(Channel.UNLIMITED)
    val session = PcmRecordingSession(5, file, input, this, { terminal.trySend(it) })
    session.start(300.0)
    input.reads.receive()
    input.responses.put(shortArrayOf())
    val result = terminal.receive()
    assertTrue(result.hasError)
    assertNotNull(result.error)
    assertFalse(file.exists())
    assertEquals(1, input.closeCount.get())
    assertEquals(result, session.stop())
  }

  @Test
  fun `discarding a prepared recording closes input without starting microphone`() = runBlocking {
    val file = Files.createTempFile("pcm-prepared", ".wav").toFile()
    val input = QueuedPcmInput()
    val terminal = Channel<PcmRecordingState>(Channel.UNLIMITED)
    val session = PcmRecordingSession(6, file, input, this, { terminal.trySend(it) })
    assertTrue(session.status().canRecord)
    session.dispose()
    assertFalse(file.exists())
    assertEquals(0, input.startCount.get())
    assertEquals(1, input.closeCount.get())
    assertTrue(terminal.tryReceive().isFailure)
  }

  @Test
  fun `hardware startup failure closes input and deletes WAV`() = runBlocking {
    val file = Files.createTempFile("pcm-start-error", ".wav").toFile()
    val input = QueuedPcmInput()
    val failing = object : PcmCaptureInput by input {
      override fun start() = error("Microphone permission was revoked.")
    }
    val terminal = Channel<PcmRecordingState>(Channel.UNLIMITED)
    val session = PcmRecordingSession(7, file, failing, this, { terminal.trySend(it) })
    assertTrue(runCatching { session.start(300.0) }.isFailure)
    val result = terminal.receive()
    assertEquals("Microphone permission was revoked.", result.error)
    assertTrue(result.hasError)
    assertFalse(file.exists())
    assertEquals(1, input.closeCount.get())
    assertEquals(result, session.dispose())
  }

  @Test
  fun `module cancellation before reader dispatch still releases microphone`() = runBlocking {
    val file = Files.createTempFile("pcm-cancel-launch", ".wav").toFile()
    val input = QueuedPcmInput()
    val queued = LinkedBlockingQueue<Runnable>()
    val holdFirst = AtomicBoolean(true)
    val dispatcher = object : CoroutineDispatcher() {
      override fun dispatch(context: CoroutineContext, block: Runnable) {
        if (holdFirst.compareAndSet(true, false)) {
          queued.add(block)
        } else {
          Dispatchers.IO.dispatch(context, block)
        }
      }
    }
    val lifetime = SupervisorJob()
    val terminal = Channel<PcmRecordingState>(Channel.UNLIMITED)
    val session = PcmRecordingSession(
      8,
      file,
      input,
      CoroutineScope(lifetime + dispatcher),
      { terminal.trySend(it) }
    )
    try {
      session.start(300.0)
      val launch = queued.poll()
      assertNotNull("Capture must be queued before returning from start.", launch)
      lifetime.cancel()
      requireNotNull(launch).run()
      val result = terminal.receive()
      lifetime.join()
      assertTrue(result.hasError)
      assertEquals(1, input.closeCount.get())
      assertFalse(file.exists())
      assertTrue(input.reads.tryReceive().isFailure)
    } finally {
      session.dispose()
      lifetime.cancelAndJoin()
      file.delete()
    }
  }

  private fun assertWave(file: File, frames: Int) {
    val header = ByteBuffer.wrap(file.inputStream().use { it.readNBytes(WAV_HEADER_BYTES) })
      .order(ByteOrder.LITTLE_ENDIAN)
    assertEquals("RIFF", String(header.array(), 0, 4))
    assertEquals(frames * 2 + 36, header.getInt(4))
    assertEquals("WAVEfmt ", String(header.array(), 8, 8))
    assertEquals(16, header.getInt(16))
    assertEquals(1, header.getShort(20).toInt())
    assertEquals(1, header.getShort(22).toInt())
    assertEquals(PCM_SAMPLE_RATE, header.getInt(24))
    assertEquals(PCM_SAMPLE_RATE * 2, header.getInt(28))
    assertEquals(2, header.getShort(32).toInt())
    assertEquals(16, header.getShort(34).toInt())
    assertEquals("data", String(header.array(), 36, 4))
    assertEquals(frames * 2, header.getInt(40))
    assertEquals(WAV_HEADER_BYTES + frames * 2L, file.length())
  }
}

internal class QueuedPcmInput(private val stopTail: ShortArray = shortArrayOf()) : PcmCaptureInput {
  val reads = Channel<Int>(Channel.UNLIMITED)
  val responses = LinkedBlockingQueue<ShortArray>()
  val closeCount = AtomicInteger()
  val startCount = AtomicInteger()
  private var closed = false

  override fun start() {
    startCount.incrementAndGet()
  }

  override fun read(samples: ShortArray, count: Int): Int {
    reads.trySend(count)
    val response = responses.take()
    response.copyInto(samples)
    return response.size
  }

  override fun stop() {
    responses.offer(stopTail)
  }

  override fun close() {
    if (!closed) {
      closed = true
      closeCount.incrementAndGet()
    }
  }

  override fun setInput(uid: String) = Unit
}
