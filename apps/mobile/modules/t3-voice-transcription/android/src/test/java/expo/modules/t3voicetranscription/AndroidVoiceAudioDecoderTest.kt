package expo.modules.t3voicetranscription

import android.media.AudioFormat
import java.nio.ByteBuffer
import java.nio.ByteOrder
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class AndroidVoiceAudioDecoderTest {
  @Test
  fun convertsSignedPcm16WithoutTruncatingNormalizedSamples() {
    val samples = decodeVoicePcm(
      pcm16(-32768, -16384, 0, 16384, 32767),
      VoicePcmFormat(44100, 1, AudioFormat.ENCODING_PCM_16BIT)
    )
    assertArrayEquals(floatArrayOf(-1f, -.5f, 0f, .5f, 32767f / 32768f), samples, 0f)
  }

  @Test
  fun averagesStereoChannelsWithoutChangingTheirGain() {
    val samples = decodeVoicePcm(
      pcm16(16384, 16384, -16384, -16384, 16384, -16384, -32768, 32767),
      VoicePcmFormat(44100, 2, AudioFormat.ENCODING_PCM_16BIT)
    )
    assertArrayEquals(floatArrayOf(.5f, -.5f, 0f, -1f / 65536f), samples, 0f)
  }

  @Test
  fun preservesFinitePcmFloatValuesWhileDownmixing() {
    for ((channels, input, expected) in listOf(
      Triple(1, floatArrayOf(.25f, -.75f, 1.25f), floatArrayOf(.25f, -.75f, 1.25f)),
      Triple(2, floatArrayOf(.25f, .75f, -.5f, -.5f, 1.5f, 1.5f), floatArrayOf(.5f, -.5f, 1.5f))
    )) {
      assertArrayEquals(
        expected,
        decodeVoicePcm(
          pcmFloat(*input),
          VoicePcmFormat(48000, channels, AudioFormat.ENCODING_PCM_FLOAT)
        ),
        0f
      )
    }
  }

  @Test
  fun consumesOnlyTheBufferWindowWithoutChangingItsPosition() {
    val input = pcm16(30000, 16384, -16384, 25000)
    input.position(2)
    input.limit(6)
    input.order(
      if (ByteOrder.nativeOrder() == ByteOrder.LITTLE_ENDIAN) {
        ByteOrder.BIG_ENDIAN
      } else {
        ByteOrder.LITTLE_ENDIAN
      }
    )
    assertArrayEquals(
      floatArrayOf(.5f, -.5f),
      decodeVoicePcm(
        input,
        VoicePcmFormat(16000, 1, AudioFormat.ENCODING_PCM_16BIT)
      ),
      0f
    )
    assertEquals(2, input.position())
    assertEquals(6, input.limit())
  }

  @Test
  fun rejectsUnsupportedChannelLayoutsEncodingsAndRates() {
    for ((rate, channels, encoding) in listOf(
      Triple(44100, 0, AudioFormat.ENCODING_PCM_16BIT),
      Triple(44100, 3, AudioFormat.ENCODING_PCM_16BIT),
      Triple(44100, -1, AudioFormat.ENCODING_PCM_FLOAT),
      Triple(44100, 1, AudioFormat.ENCODING_PCM_8BIT),
      Triple(44100, 1, 0),
      Triple(0, 1, AudioFormat.ENCODING_PCM_16BIT),
      Triple(192001, 1, AudioFormat.ENCODING_PCM_16BIT)
    )) {
      assertThrows(IllegalArgumentException::class.java) {
        VoicePcmFormat(rate, channels, encoding)
      }
    }
  }

  @Test
  fun rejectsTruncatedSamplesAndInterleavedFrames() {
    for ((channels, encoding, size) in listOf(
      Triple(1, AudioFormat.ENCODING_PCM_16BIT, 1),
      Triple(2, AudioFormat.ENCODING_PCM_16BIT, 6),
      Triple(1, AudioFormat.ENCODING_PCM_FLOAT, 3),
      Triple(2, AudioFormat.ENCODING_PCM_FLOAT, 12)
    )) {
      assertThrows(IllegalArgumentException::class.java) {
        decodeVoicePcm(ByteBuffer.allocate(size), VoicePcmFormat(16000, channels, encoding))
      }
    }
  }

  @Test
  fun rejectsNonfiniteSamplesInEitherChannel() {
    for (value in listOf(Float.NaN, Float.POSITIVE_INFINITY, Float.NEGATIVE_INFINITY)) {
      for ((channels, samples) in listOf(
        1 to floatArrayOf(value),
        2 to floatArrayOf(value, 0f),
        2 to floatArrayOf(0f, value)
      )) {
        assertThrows(IllegalArgumentException::class.java) {
          decodeVoicePcm(
            pcmFloat(*samples),
            VoicePcmFormat(44100, channels, AudioFormat.ENCODING_PCM_FLOAT)
          )
        }
      }
    }
  }

  @Test
  fun retainsTheActualOutputRateAndRejectsFormatChangesAfterSamples() {
    val output = VoicePcmAccumulator()
    output.setFormat(VoicePcmFormat(44100, 2, AudioFormat.ENCODING_PCM_16BIT))
    output.setFormat(VoicePcmFormat(48000, 1, AudioFormat.ENCODING_PCM_FLOAT))
    output.append(pcmFloat(.25f))
    output.append(pcmFloat(-.5f))
    for (changed in listOf(
      VoicePcmFormat(44100, 1, AudioFormat.ENCODING_PCM_FLOAT),
      VoicePcmFormat(48000, 2, AudioFormat.ENCODING_PCM_FLOAT),
      VoicePcmFormat(48000, 1, AudioFormat.ENCODING_PCM_16BIT)
    )) {
      assertThrows(IllegalArgumentException::class.java) { output.setFormat(changed) }
    }
    val decoded = output.finish()
    assertEquals(48000, decoded.sampleRate)
    assertArrayEquals(floatArrayOf(.25f, -.5f), decoded.samples, 0f)
  }

  @Test
  fun rejectsDecodedAudioBeyondTheRecordingLimitBeforeAllocatingSamples() {
    val output = VoicePcmAccumulator()
    output.setFormat(VoicePcmFormat(8000, 1, AudioFormat.ENCODING_PCM_16BIT))
    val tooLong = ByteBuffer.allocate((301 * 8000 + 1) * 2)
    assertThrows(IllegalArgumentException::class.java) { output.append(tooLong) }
  }

  private fun pcm16(vararg samples: Int): ByteBuffer =
    ByteBuffer.allocate(samples.size * 2).order(ByteOrder.nativeOrder()).apply {
      for (sample in samples) putShort(sample.toShort())
      flip()
    }

  private fun pcmFloat(vararg samples: Float): ByteBuffer =
    ByteBuffer.allocate(samples.size * 4).order(ByteOrder.nativeOrder()).apply {
      for (sample in samples) putFloat(sample)
      flip()
    }
}
