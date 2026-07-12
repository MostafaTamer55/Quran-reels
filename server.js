const express = require('express');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());

// دالة تحويل الثواني لتنسيق SRT
function formatSRTTime(seconds) {
    if (isNaN(seconds) || seconds < 0) seconds = 0;
    const date = new Date(0);
    date.setSeconds(seconds);
    const timeString = date.toISOString().substr(11, 8);
    const ms = Math.floor((seconds % 1) * 1000).toString().padStart(3, '0');
    return `${timeString},${ms}`;
}

// دالة إجبارية لتنظيف النص تماماً من كل الزخارف والتشكيل العثماني لمنع الـ الكراش والمربعات []
function stripAllZakhrafa(text) {
    if (!text) return "آية قرآنية";
    return text
        .replace(/[\u064B-\u065F]/g, "") // حذف التشكيل بالكامل
        .replace(/[\u0610-\u0615]/g, "") // حذف علامات الضبط
        .replace(/[\u06D6-\u06ED]/g, "") // حذف علامات الوقف العثمانية (المسببة للمربعات)
        .replace(/ٰ/g, "ا")             // تحويل الألف الخنجرية
        .replace(/[^\u0600-\u06FF\s]/g, "") // حذف أي رموز غريبة خارج الحروف العربية
        .replace(/\s+/g, " ")
        .trim();
}

app.post('/api/make-video', async (req, res) => {
    let { audioUrl, ayahs, surah_id } = req.body;

    if (Array.isArray(audioUrl)) audioUrl = audioUrl[0];
    if (typeof audioUrl === 'string') audioUrl = audioUrl.replace(/[\[\]]/g, '').trim();

    if (!audioUrl || !audioUrl.startsWith('http') || !ayahs || ayahs.length === 0) {
        return res.status(400).json({ success: false, message: 'Invalid or missing parameters' });
    }

    const timestamp = Date.now();
    const srtPath = path.join(__dirname, 'uploads', `sub_${timestamp}.srt`);
    const outputPath = path.join(__dirname, 'uploads', `video_${timestamp}.mp4`);
    const bgImagePath = path.join(__dirname, 'background.jpg'); 

    if (!fs.existsSync(path.join(__dirname, 'uploads'))) {
        fs.mkdirSync(path.join(__dirname, 'uploads'));
    }

    try {
        const firstAyahNum = parseInt(ayahs[0].numberInSurah || 1);
        
        // حساب التوقيت التقريبي النظيف للقطع
        let startTimeSeconds = (firstAyahNum - 1) * 6.4; 
        if (parseInt(surah_id) === 2) {
            if (firstAyahNum <= 5) startTimeSeconds = (firstAyahNum - 1) * 7.5;
            else if (firstAyahNum > 5 && firstAyahNum <= 15) startTimeSeconds = 35 + (firstAyahNum - 5) * 5.8;
            else if (firstAyahNum >= 40 && firstAyahNum <= 50) startTimeSeconds = 248 + (firstAyahNum - 40) * 6.5;
            else startTimeSeconds = (firstAyahNum - 1) * 6.2;
        }

        // حساب توقيت مرن بناءً على طول النص لضمان التطابق
        let totalDuration = 0;
        let srtContent = '';

        ayahs.forEach((ayah, index) => {
            const cleanText = stripAllZakhrafa(ayah.text);
            let duration = Math.max(5, Math.min(11, cleanText.length * 0.12));
            
            const start = totalDuration;
            const end = totalDuration + duration;

            srtContent += `${index + 1}\n`;
            srtContent += `${formatSRTTime(start)} --> ${formatSRTTime(end)}\n`;
            srtContent += `${cleanText}\n\n`;

            totalDuration += duration;
        });

        // حفظ ملف الترجمة بترميز UTF-8 نظيف وصريح ومتوافق مع Linux
        fs.writeFileSync(srtPath, srtContent, 'utf-8');

        let command = ffmpeg().input(audioUrl).inputOptions([`-ss ${startTimeSeconds}`, `-t ${totalDuration}`]);

        if (fs.existsSync(bgImagePath)) {
            command.input(bgImagePath).inputOptions(['-loop 1', `-t ${totalDuration}`]);
        } else {
            command.input('color=c=0x111827:s=720x1280:r=25').inputOptions(['-f lavfi', `-t ${totalDuration}`]);
        }

        command
            .complexFilter([
                // استخدام الـ subtitles الخفيف الافتراضي بدون فرض أسماء خطوط معقدة لضمان السرعة والـ ثبات
                `[1:v]scale=720:1280,subtitles=${srtPath.replace(/\\/g, '/')}:force_style='Alignment=2,Fontsize=22,PrimaryColour=&HFFFFFF,Outline=1,OutlineColour=&H000000,MarginV=140'[v]`
            ])
            .outputOptions([
                '-map 0:a',          
                '-map [v]',          
                '-pix_fmt yuv420p',
                '-c:v libx264',
                '-preset ultrafast', // أسرع إعداد رندر في العالم عشان نمنع الـ Timeout
                '-c:a aac',
                '-shortest'
            ])
            .output(outputPath)
            .on('end', () => {
                if (fs.existsSync(srtPath)) fs.unlinkSync(srtPath);
                res.download(outputPath, 'quran_reel.mp4', () => {
                    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
                });
            })
            .on('error', (err) => {
                console.error("FFmpeg error:", err);
                if (fs.existsSync(srtPath)) fs.unlinkSync(srtPath);
                if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
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
app.listen(PORT, () => console.log(`Super Fast Quran Reels Generator Running on port ${PORT}`));
