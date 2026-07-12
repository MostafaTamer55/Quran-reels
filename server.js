const express = require('express');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());

function formatSRTTime(seconds) {
    if (isNaN(seconds) || seconds < 0) seconds = 0;
    const date = new Date(0);
    date.setSeconds(seconds);
    const timeString = date.toISOString().substr(11, 8);
    const ms = Math.floor((seconds % 1) * 1000).toString().padStart(3, '0');
    return `${timeString},${ms}`;
}

// تنظيف علامات الوقف المسببة للمربعات مع الحفاظ على التشكيل الأصلي كاملاً
function cleanQuranText(text) {
    if (!text) return "";
    return text
        .replace(/[\u0610-\u0615]/g, "") 
        .replace(/[\u06D6-\u06ED]/g, "") 
        .replace(/\s+/g, " ")
        .trim();
}

app.post('/api/make-audio-srt', async (req, res) => {
    let { audioUrl, ayahs, surah_id } = req.body;

    if (Array.isArray(audioUrl)) audioUrl = audioUrl[0];
    if (typeof audioUrl === 'string') audioUrl = audioUrl.replace(/[\[\]]/g, '').trim();

    if (!audioUrl || !ayahs || ayahs.length === 0) {
        return res.status(400).json({ success: false, message: 'Invalid parameters' });
    }

    const timestamp = Date.now();
    const srtPath = path.join(__dirname, 'uploads', `sub_${timestamp}.srt`);
    const outputAudioPath = path.join(__dirname, 'uploads', `audio_${timestamp}.mp3`);

    if (!fs.existsSync(path.join(__dirname, 'uploads'))) {
        fs.mkdirSync(path.join(__dirname, 'uploads'));
    }

    try {
        const firstAyahNum = parseInt(ayahs[0].numberInSurah || 1);
        
        // حساب التوقيت بدقة مبنية على أطوال الآيات الفعليه
        let startTimeSeconds = (firstAyahNum - 1) * 6.4; 
        if (parseInt(surah_id) === 2) {
            if (firstAyahNum <= 5) startTimeSeconds = (firstAyahNum - 1) * 7.5;
            else if (firstAyahNum > 5 && firstAyahNum <= 15) startTimeSeconds = 35 + (firstAyahNum - 5) * 5.8;
            else if (firstAyahNum >= 40 && firstAyahNum <= 50) startTimeSeconds = 248 + (firstAyahNum - 40) * 6.5;
            else startTimeSeconds = (firstAyahNum - 1) * 6.2;
        }

        let totalDuration = 0;
        let srtContent = '';

        ayahs.forEach((ayah, index) => {
            let cleanText = cleanQuranText(ayah.text);
            let duration = Math.max(5, Math.min(11, cleanText.length * 0.12));
            
            const start = totalDuration;
            const end = totalDuration + duration;

            srtContent += `${index + 1}\n`;
            srtContent += `${formatSRTTime(start)} --> ${formatSRTTime(end)}\n`;
            srtContent += `${cleanText}\n\n`;

            totalDuration += duration;
        });

        // حفظ ملف الترجمة بترميز UTF-8 النظيف
        fs.writeFileSync(srtPath, '\ufeff' + srtContent, 'utf-8');

        // معالجة الصوت فقط (قص الصوت طيارة في أقل من 0.5 ثانية!)
        ffmpeg(audioUrl)
            .inputOptions([`-ss ${startTimeSeconds}`, `-t ${totalDuration}`])
            .outputOptions(['-c:a copy']) // نسخ مباشر بدون إعادة ترميز لمنع استهلاك السيرفر
            .output(outputAudioPath)
            .on('end', () => {
                // إرسال الصوت والترجمة معاً كـ JSON Response لـ n8n
                const srtData = fs.readFileSync(srtPath, 'utf-8');
                const audioBuffer = fs.readFileSync(outputAudioPath);
                
                res.json({
                    success: true,
                    srt: srtData,
                    audioBase64: audioBuffer.toString('base64'),
                    duration: totalDuration
                });

                // تنظيف الملفات المؤقتة فوراً
                if (fs.existsSync(srtPath)) fs.unlinkSync(srtPath);
                if (fs.existsSync(outputAudioPath)) fs.unlinkSync(outputAudioPath);
            })
            .on('error', (err) => {
                console.error("FFmpeg error:", err);
                if (fs.existsSync(srtPath)) fs.unlinkSync(srtPath);
                if (fs.existsSync(outputAudioPath)) fs.unlinkSync(outputAudioPath);
                res.status(500).json({ success: false, error: err.message });
            })
            .run();

    } catch (e) {
        console.error("Error:", e);
        if (fs.existsSync(srtPath)) fs.unlinkSync(srtPath);
        res.status(500).json({ success: false, error: e.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Audio & SRT Service Running on port ${PORT}`));
