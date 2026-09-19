package app.diarog.companion

import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.ResolverStyle

object AudioMath {
    fun monoPcm16(bytes: ByteArray, channels: Int): ByteArray {
        require(channels in 1..8 && bytes.size % (2 * channels) == 0) { "잘못된 PCM 프레임" }
        val input = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
        val output = ByteBuffer.allocate(bytes.size / channels).order(ByteOrder.LITTLE_ENDIAN)
        while(input.hasRemaining()) {
            var sum = 0
            repeat(channels) { sum += input.short.toInt() }
            output.putShort((sum / channels).toShort())
        }
        return output.array()
    }
    fun recordingStart(name: String, zone: ZoneId): Instant? {
        // Samsung-style filenames: ..._20260919_143012 or ..._260919_143012.
        val match = Regex("(?<![0-9])([0-9]{8}|[0-9]{6})[_ -]([0-9]{6})(?![0-9])").find(name) ?: return null
        val date = match.groupValues[1].let { if(it.length == 6) "20$it" else it }
        return runCatching { LocalDateTime.parse(date + match.groupValues[2], DateTimeFormatter.ofPattern("uuuuMMddHHmmss").withResolverStyle(ResolverStyle.STRICT)).atZone(zone).toInstant() }.getOrNull()
    }
}
