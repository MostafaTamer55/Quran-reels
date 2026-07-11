const express = require('express');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');

const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(express.json());

// دالة مساعدة لتحويل الثواني لتنسيق ملفات الترجمة SRT (00:00:00,000)
function formatSRTTime(seconds) {
    const date = new Date(0);
    date.setSeconds(seconds);
    const timeString = date.toISOString().substr(11, 8);
    return `${timeString},000`;
}

app.post('/api/make-video', upload.single('audio'), (req, res) => {
    const audioFile = req.file;
    const ayahsData = req.body.ayahs;

    if (!audioFile || !ayahsData) {
        return res.status(400).json({ success: false, message: 'Missing audio or ayahs data' });
    }

    const ayahs = JSON.parse(ayahsData);
    const timestamp = Date.now();
    const srtPath = path.join(__dirname, 'uploads', `sub_${timestamp}.srt`);
    const outputPath = path.join(__dirname, 'uploads', `video_${timestamp}.mp4`);

    // 1. توليد ملف الترجمة تلقائياً بناءً على الآيات
    let srtContent = '';
    const durationPerAyah = 4; // مدة ظهور كل آية بالثواني

    ayahs.forEach((ayah, index) => {
        const start = index * durationPerAyah;
        const end = start + durationPerAyah;
        
        srtContent += `${index + 1}\n`;
        srtContent += `${formatSRTTime(start)} --> ${formatSRTTime(end)}\n`;
        srtContent += `${ayah.text}\n\n`;
    });

    fs.writeFileSync(srtPath, srtContent, 'utf-8');

    // 2. تشغيل الـ FFmpeg لتركيب الصوت والترجمة فوق الخلفية الداكنة
    // تم تعديل الفلتر ليكون نقي ومستقر تماماً
    ffmpeg()
        .input(audioFile.path)
        .input('color=c=0x111827:s=1080x1920') // خلفية الـ Reels الداكنة
        .inputOptions(['-f lavfi'])
        .complexFilter([
            `[1:v]subtitles=${srtPath.replace(/\\/g, '/')}:force_style='Alignment=2,FontSize=24,Fontname=Arial,PrimaryColour=&HFFFFFF'[v]`
        ])
        .outputOptions([
            '-map 0:a',          // أخذ الصوت من المدخل الأول
            '-map [v]',          // أخذ الفيديو المضاف إليه النص
            '-pix_fmt yuv420p',
            '-c:v libx264',
            '-c:a aac',
            '-shortest'          // إنهاء الفيديو فور انتهاء صوت الآيات
        ])
        .output(outputPath)
        .on('end', () => {
            // تنظيف الملفات المؤقتة من السيرفر فوراً
            if (fs.existsSync(audioFile.path)) fs.unlinkSync(audioFile.path);
            if (fs.existsSync(srtPath)) fs.unlinkSync(srtPath);

            // إرسال الـ MP4 النهائي لـ n8n
            res.download(outputPath, 'quran_reel.mp4', () => {
                if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
            });
        })
        .on('error', (err) => {
            console.error(err);
            // تنظيف الملفات في حالة الفشل
            if (fs.existsSync(audioFile.path)) fs.unlinkSync(audioFile.path);
            if (fs.existsSync(srtPath)) fs.unlinkSync(srtPath);
            res.status(500).json({ success: false, error: err.message });
        })
        .run();
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API running on port ${PORT}`));
