package expo.modules.t3voicetranscription

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PcmCommunicationRouteTest {
  @Test
  fun `route cleanup restores original across microphone switches`() {
    val routing = Routing()
    val lease = routing.lease()
    lease.acquire(2)
    lease.acquire(3)
    assertEquals(3, routing.current)
    lease.restore()
    assertEquals(1, routing.current)
    assertEquals(listOf(2, 3, 1), routing.selected)
    lease.restore()
    assertEquals(listOf(2, 3, 1), routing.selected)
  }

  @Test
  fun `route cleanup preserves external changes and active calls`() {
    val routing = Routing()
    val lease = routing.lease()
    lease.acquire(2)
    routing.current = 4
    lease.restore()
    assertEquals(4, routing.current)
    lease.acquire(2)
    routing.idle = false
    lease.restore()
    assertEquals(2, routing.current)
    assertTrue(runCatching { lease.acquire(3) }.isFailure)
    assertEquals(2, routing.current)
  }

  @Test
  fun `existing route is not owned and missing previous route clears preference`() {
    val routing = Routing()
    val lease = routing.lease()
    lease.acquire(1)
    lease.restore()
    assertTrue(routing.selected.isEmpty())
    lease.acquire(2)
    routing.available = false
    lease.restore()
    assertEquals(null, routing.current)
    assertEquals(1, routing.clearCount)
  }

  private class Routing {
    var current: Int? = 1
    var idle = true
    var available = true
    var clearCount = 0
    val selected = mutableListOf<Int>()

    fun lease() = PcmCommunicationRoute(
      current = { current },
      available = { available },
      isIdle = { idle },
      select = {
        selected.add(it)
        current = it
        true
      },
      clear = {
        current = null
        clearCount++
      }
    )
  }
}
