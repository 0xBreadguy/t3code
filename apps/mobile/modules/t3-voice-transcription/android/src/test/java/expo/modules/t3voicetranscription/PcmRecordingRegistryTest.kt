package expo.modules.t3voicetranscription

import java.io.File
import java.nio.file.Files
import java.util.concurrent.CountDownLatch
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PcmRecordingRegistryTest {
  @Test
  fun `late old release does not dispose a newer prepared recording`() = runBlocking {
    val directory = Files.createTempDirectory("pcm-registry").toFile()
    val inputs = mutableMapOf<Int, QueuedPcmInput>()
    val registry = PcmRecordingRegistry { id ->
      val input = QueuedPcmInput().also { inputs[id] = it }
      PcmRecordingSession(id, File(directory, "$id.wav"), input, this, {})
    }
    try {
      registry.prepare(1)
      registry.prepare(2)
      assertEquals(1, inputs.getValue(1).closeCount.get())
      registry.release(1)
      assertEquals(0, inputs.getValue(2).closeCount.get())
      assertTrue(requireNotNull(registry.status(2)).canRecord)
      assertNull(registry.status(1))
      registry.release(2)
      registry.release(2)
      assertEquals(1, inputs.getValue(2).closeCount.get())
    } finally {
      registry.close()
      registry.releaseInterrupted()
      directory.deleteRecursively()
    }
  }

  @Test
  fun `release before prepare tombstones the id without creating hardware`() = runBlocking {
    var creations = 0
    val registry = PcmRecordingRegistry {
      creations++
      error("A released id must not create a microphone.")
    }
    registry.release(7)
    assertTrue(runCatching { registry.prepare(7) }.isFailure)
    assertEquals(0, creations)
  }

  @Test
  fun `release during preparation awaits cleanup and rejects late result`() = runBlocking {
    val file = Files.createTempFile("pcm-pending", ".wav").toFile()
    val creating = CompletableDeferred<Unit>()
    val allowCreation = CountDownLatch(1)
    val input = QueuedPcmInput()
    val registry = PcmRecordingRegistry { id ->
      creating.complete(Unit)
      allowCreation.await()
      PcmRecordingSession(id, file, input, this, {})
    }
    val preparing = async(Dispatchers.IO) { runCatching { registry.prepare(8) } }
    creating.await()
    val releasing = async(start = CoroutineStart.UNDISPATCHED) { registry.release(8) }
    assertFalse(releasing.isCompleted)
    allowCreation.countDown()
    assertTrue(preparing.await().isFailure)
    releasing.await()
    assertEquals(1, input.closeCount.get())
    assertFalse(file.exists())
    assertNull(registry.status(8))
  }

  @Test
  fun `background closes prepared input and blocks recording until foreground`() = runBlocking {
    val directory = Files.createTempDirectory("pcm-background").toFile()
    val inputs = mutableMapOf<Int, QueuedPcmInput>()
    val registry = PcmRecordingRegistry { id ->
      PcmRecordingSession(
        id,
        File(directory, "$id.wav"),
        QueuedPcmInput().also { inputs[id] = it },
        this,
        {}
      )
    }
    try {
      registry.prepare(9)
      registry.setBackground(true)
      registry.releaseInterrupted()
      assertEquals(1, inputs.getValue(9).closeCount.get())
      assertFalse(File(directory, "9.wav").exists())
      assertTrue(runCatching { registry.prepare(10) }.isFailure)
      registry.setBackground(false)
      registry.prepare(11)
      assertTrue(requireNotNull(registry.status(11)).canRecord)
      registry.close()
      registry.releaseInterrupted()
      assertEquals(1, inputs.getValue(11).closeCount.get())
    } finally {
      registry.close()
      registry.releaseInterrupted()
      directory.deleteRecursively()
    }
  }
}
