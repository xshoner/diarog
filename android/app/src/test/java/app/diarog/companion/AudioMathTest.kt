package app.diarog.companion

import org.junit.Assert.*
import org.junit.Test
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.time.ZoneId

class AudioMathTest {
    @Test fun stereoDownmixDoesNotOverflowOrSwapEndianness() {
        val input = ByteBuffer.allocate(12).order(ByteOrder.LITTLE_ENDIAN)
            .putShort(32767).putShort(32767).putShort(-32768).putShort(-32768).putShort(2000).putShort(-1000).array()
        val output = ByteBuffer.wrap(AudioMath.monoPcm16(input, 2)).order(ByteOrder.LITTLE_ENDIAN)
        assertEquals(32767, output.short.toInt()); assertEquals(-32768, output.short.toInt()); assertEquals(500, output.short.toInt())
    }
    @Test(expected = IllegalArgumentException::class) fun rejectPartialPcmFrame() { AudioMath.monoPcm16(byteArrayOf(1, 2, 3), 2) }
    @Test fun monoRemainsUnchanged() { val bytes = byteArrayOf(0, -128, -1, 127); assertArrayEquals(bytes, AudioMath.monoPcm16(bytes, 1)) }
    @Test fun samsungFilenameUsesExplicitTimezone() {
        val zone = ZoneId.of("Asia/Seoul")
        assertEquals("2026-09-19T05:30:12Z", AudioMath.recordingStart("통화 녹음_260919_143012.m4a", zone).toString())
        assertEquals("2026-09-19T05:30:12Z", AudioMath.recordingStart("call_20260919_143012.mp3", zone).toString())
    }
    @Test fun invalidDatesAndUnrecognizedFilenamesRemainUnknown() {
        val zone = ZoneId.of("Asia/Seoul")
        assertNull(AudioMath.recordingStart("call_260230_123000.m4a", zone))
        assertNull(AudioMath.recordingStart("call.mp3", zone))
        assertNull(AudioMath.recordingStart("phone_01012345678.m4a", zone))
    }
}
