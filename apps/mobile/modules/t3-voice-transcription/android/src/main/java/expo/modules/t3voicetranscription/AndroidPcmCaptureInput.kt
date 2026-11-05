package expo.modules.t3voicetranscription

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioDeviceInfo
import android.media.AudioDeviceCallback
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.AudioRecordingConfiguration
import android.media.MediaRecorder
import android.os.Build
import java.util.concurrent.atomic.AtomicBoolean

internal class AndroidPcmCaptureInput private constructor(
  private val recorder: AudioRecord,
  private val audioManager: AudioManager,
  private val context: Context
) : PcmCaptureInput {
  private val closed = AtomicBoolean(false)
  private val stopped = AtomicBoolean(false)

  @Volatile private var preferredUid: String? = null

  @Volatile private var captureError: String? = null
  private val communicationRoute = PcmCommunicationRoute(
    current = { audioManager.communicationDevice?.id },
    available = { id -> audioManager.availableCommunicationDevices.any { it.id == id } },
    isIdle = { audioManager.mode == AudioManager.MODE_NORMAL },
    select = { id ->
      audioManager.availableCommunicationDevices.firstOrNull { it.id == id }
        ?.let { audioManager.setCommunicationDevice(it) } == true
    },
    clear = { audioManager.clearCommunicationDevice() }
  )
  private val deviceCallback = object : AudioDeviceCallback() {
    override fun onAudioDevicesRemoved(removedDevices: Array<out AudioDeviceInfo>) {
      if (removedDevices.any { it.id.toString() == preferredUid }) {
        captureError = "The selected microphone was disconnected."
        stop()
      }
    }
  }
  private val recordingCallback = object : AudioManager.AudioRecordingCallback() {
    override fun onRecordingConfigChanged(configs: MutableList<AudioRecordingConfiguration>) {
      if (configs.any { it.isClientSilenced }) {
        captureError =
          "Android silenced the microphone. Check microphone privacy settings and other recording apps."
        stop()
      }
    }
  }

  override fun start() {
    check(!closed.get()) { "The microphone is closed." }
    val selected = preferredUid
    check(selected == null || inputDevices(audioManager).any { it.id.toString() == selected }) {
      "The selected microphone was disconnected."
    }
    audioManager.registerAudioDeviceCallback(deviceCallback, null)
    recorder.registerAudioRecordingCallback(context.mainExecutor, recordingCallback)
    recorder.startRecording()
    check(recorder.recordingState == AudioRecord.RECORDSTATE_RECORDING) {
      "Android could not start the microphone."
    }
    check(recorder.activeRecordingConfiguration?.isClientSilenced != true) {
      "Android silenced the microphone. Check microphone privacy settings and other recording apps."
    }
  }

  override fun read(samples: ShortArray, count: Int): Int {
    val read = recorder.read(samples, 0, count, AudioRecord.READ_BLOCKING)
    check(captureError == null) { requireNotNull(captureError) }
    return read
  }

  override fun stop() {
    if (!closed.get() && stopped.compareAndSet(false, true)) runCatching { recorder.stop() }
  }

  override fun close() {
    if (closed.compareAndSet(false, true)) {
      runCatching { recorder.stop() }
      runCatching { audioManager.unregisterAudioDeviceCallback(deviceCallback) }
      runCatching { recorder.unregisterAudioRecordingCallback(recordingCallback) }
      try {
        recorder.release()
      } finally {
        communicationRoute.restore()
      }
    }
  }

  override fun setInput(uid: String) {
    check(!closed.get()) { "The microphone is closed." }
    val device = inputDevices(audioManager).firstOrNull { it.id.toString() == uid }
    requireNotNull(device) { "The selected microphone is not connected." }
    if (device.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO ||
      device.type == AudioDeviceInfo.TYPE_BLE_HEADSET
    ) {
      selectCommunicationDevice(device)
    } else {
      communicationRoute.restore()
    }
    runCatching {
      check(recorder.setPreferredDevice(device)) { "Android could not select this microphone." }
    }.onFailure {
      communicationRoute.restore()
    }.getOrThrow()
    preferredUid = uid
  }

  private fun selectCommunicationDevice(input: AudioDeviceInfo) {
    val device = audioManager.availableCommunicationDevices.firstOrNull {
      it.id == input.id || (it.type == input.type && it.address == input.address)
    }
    requireNotNull(device) { "Android cannot route this Bluetooth microphone." }
    communicationRoute.acquire(device.id)
  }

  companion object {
    fun create(context: Context): AndroidPcmCaptureInput {
      check(Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        "Direct PCM recording requires Android 12 or later."
      }
      check(
        context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) ==
          PackageManager.PERMISSION_GRANTED
      ) {
        "Microphone permission has not been granted."
      }
      val minimum = AudioRecord.getMinBufferSize(
        PCM_SAMPLE_RATE,
        AudioFormat.CHANNEL_IN_MONO,
        AudioFormat.ENCODING_PCM_16BIT
      )
      check(minimum > 0) { "This device does not support 16 kHz mono PCM microphone recording." }
      val recorder = AudioRecord.Builder()
        .setAudioSource(MediaRecorder.AudioSource.MIC)
        .setAudioFormat(
          AudioFormat.Builder()
            .setSampleRate(PCM_SAMPLE_RATE)
            .setChannelMask(AudioFormat.CHANNEL_IN_MONO)
            .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
            .build()
        )
        .setBufferSizeInBytes(maxOf(minimum, PCM_READ_FRAMES * 4))
        .setPrivacySensitive(true)
        .build()
      return runCatching {
        check(
          recorder.state == AudioRecord.STATE_INITIALIZED &&
            recorder.sampleRate == PCM_SAMPLE_RATE && recorder.channelCount == 1 &&
            recorder.audioFormat == AudioFormat.ENCODING_PCM_16BIT
        ) { "Android did not configure the required 16 kHz mono PCM16 microphone format." }
        AndroidPcmCaptureInput(
          recorder,
          context.getSystemService(AudioManager::class.java),
          context
        )
      }.onFailure {
        recorder.release()
      }.getOrThrow()
    }

    fun inputs(context: Context): List<Map<String, String>> =
      inputDevices(context.getSystemService(AudioManager::class.java)).mapNotNull { device ->
        inputType(device.type)?.let {
          mapOf(
            "uid" to device.id.toString(),
            "name" to device.productName.toString(),
            "type" to it
          )
        }
      }

    private fun inputDevices(manager: AudioManager): List<AudioDeviceInfo> =
      manager.getDevices(AudioManager.GET_DEVICES_INPUTS).toList()

    private fun inputType(type: Int): String? = when (type) {
      AudioDeviceInfo.TYPE_BUILTIN_MIC -> "MicrophoneBuiltIn"
      AudioDeviceInfo.TYPE_WIRED_HEADSET -> "MicrophoneWired"
      AudioDeviceInfo.TYPE_USB_DEVICE, AudioDeviceInfo.TYPE_USB_HEADSET -> "USBAudio"
      AudioDeviceInfo.TYPE_LINE_ANALOG, AudioDeviceInfo.TYPE_LINE_DIGITAL -> "LineIn"
      AudioDeviceInfo.TYPE_BLUETOOTH_SCO -> "BluetoothHFP"
      AudioDeviceInfo.TYPE_BLE_HEADSET -> "BluetoothLE"
      else -> null
    }
  }
}
