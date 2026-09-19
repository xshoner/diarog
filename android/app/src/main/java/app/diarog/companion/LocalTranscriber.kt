package app.diarog.companion

import android.content.Context
import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import kotlinx.coroutines.ensureActive
import org.json.JSONObject
import org.vosk.Model
import org.vosk.Recognizer
import java.io.File
import kotlin.coroutines.coroutineContext

data class Transcription(val text: String, val durationMs: Long)

/** MediaCodec handles compressed files locally; only text ever leaves this pipeline. */
class LocalTranscriber(private val context: Context) {
    suspend fun transcribe(file: File): Transcription {
        check(SpeechModel.ready(context)) { "한국어 모델을 먼저 설치해 주세요." }
        val extractor = MediaExtractor()
        var decoder: MediaCodec? = null
        var recognizer: Recognizer? = null
        var model: Model? = null
        try {
            extractor.setDataSource(file.path)
            val track = (0 until extractor.trackCount).firstOrNull { extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true }
                ?: error("지원되는 오디오 트랙 없음")
            extractor.selectTrack(track)
            val format = extractor.getTrackFormat(track)
            val duration = if(format.containsKey(MediaFormat.KEY_DURATION)) format.getLong(MediaFormat.KEY_DURATION) / 1000 else 0L
            require(duration in 1..3_600_000L) { "녹음은 1시간 이하만 지원합니다." }
            format.setInteger(MediaFormat.KEY_PCM_ENCODING, AudioFormat.ENCODING_PCM_16BIT)
            decoder = MediaCodec.createDecoderByType(format.getString(MediaFormat.KEY_MIME)!!)
            decoder.configure(format, null, null, 0); decoder.start()
            model = Model(SpeechModel.directory(context).path)
            var rate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
            var channels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
            var encoding = AudioFormat.ENCODING_PCM_16BIT
            val result = StringBuilder()
            val info = MediaCodec.BufferInfo()
            var inputEnded = false; var outputEnded = false
            val deadline = android.os.SystemClock.elapsedRealtime() + 210_000L
            while(!outputEnded) {
                coroutineContext.ensureActive()
                check(android.os.SystemClock.elapsedRealtime() < deadline) { "STT 시간 초과. 녹음을 더 짧게 나눠 주세요." }
                if(!inputEnded) {
                    val index = decoder.dequeueInputBuffer(10_000)
                    if(index >= 0) {
                        val buffer = decoder.getInputBuffer(index)!!
                        val size = extractor.readSampleData(buffer, 0)
                        if(size < 0) {
                            decoder.queueInputBuffer(index, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM); inputEnded = true
                        } else {
                            decoder.queueInputBuffer(index, 0, size, extractor.sampleTime, 0); extractor.advance()
                        }
                    }
                }
                val index = decoder.dequeueOutputBuffer(info, 10_000)
                if(index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                    val output = decoder.outputFormat
                    val newRate = output.getInteger(MediaFormat.KEY_SAMPLE_RATE)
                    check(recognizer == null || rate == newRate) { "녹음 도중 샘플 속도 변경" }
                    rate = newRate; channels = output.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
                    encoding = if(output.containsKey(MediaFormat.KEY_PCM_ENCODING)) output.getInteger(MediaFormat.KEY_PCM_ENCODING) else AudioFormat.ENCODING_PCM_16BIT
                } else if(index >= 0) {
                    try {
                        if(info.size > 0) {
                            check(encoding == AudioFormat.ENCODING_PCM_16BIT) { "16-bit PCM 변환 미지원" }
                            val buffer = decoder.getOutputBuffer(index)!!
                            buffer.position(info.offset); buffer.limit(info.offset + info.size)
                            val pcm = ByteArray(info.size); buffer.get(pcm)
                            if(recognizer == null) recognizer = Recognizer(model, rate.toFloat())
                            val mono = AudioMath.monoPcm16(pcm, channels)
                            if(recognizer.acceptWaveForm(mono, mono.size)) appendResult(result, recognizer.result)
                        }
                        outputEnded = info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0
                    } finally { decoder.releaseOutputBuffer(index, false) }
                }
            }
            recognizer?.let { appendResult(result, it.finalResult) }
            check(result.isNotBlank()) { "인식된 말이 없습니다." }
            return Transcription(result.toString().trim(), duration)
        } finally {
            recognizer?.close(); model?.close()
            decoder?.run { runCatching { stop() }; release() }; extractor.release()
        }
    }
    private fun appendResult(result: StringBuilder, json: String) {
        val text = JSONObject(json).optString("text").trim()
        if(text.isNotEmpty()) { if(result.isNotEmpty()) result.append('\n'); result.append(text) }
        check(result.length <= 60_000) { "전사문 크기 초과" }
    }
}
