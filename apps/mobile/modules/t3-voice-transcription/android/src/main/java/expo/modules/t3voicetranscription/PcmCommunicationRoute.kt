package expo.modules.t3voicetranscription

internal class PcmCommunicationRoute(
  private val current: () -> Int?,
  private val available: (Int) -> Boolean,
  private val isIdle: () -> Boolean,
  private val select: (Int) -> Boolean,
  private val clear: () -> Unit
) {
  private var owned: Int? = null
  private var previous: Int? = null

  fun acquire(id: Int) {
    val existing = current()
    if (existing == id) return
    check(isIdle()) {
      "The Bluetooth microphone is currently being used by another call or audio session."
    }
    check(select(id)) { "Android could not route this Bluetooth microphone." }
    if (owned == null) previous = existing
    owned = id
  }

  fun restore() {
    val selected = owned ?: return
    if (isIdle() && current() == selected) {
      val prior = previous
      if (prior == null || !available(prior) || !select(prior)) clear()
    }
    owned = null
    previous = null
  }
}
