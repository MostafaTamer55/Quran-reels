const express = require('express');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');

const app = express();
const upload = multer({ dest: 'uploads/' });

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

app.post('/api/make-video', upload.single('audio'), (req, res) => {
    const audioFile = req.file;
    const ayahsData = req.body.ayahs;

    if (!audioFile || !ayahsData) {
        return res.status(400).json({ success: false, message: 'Missing audio or ayahs data' });
    }

    try {
        const ayahs = JSON.parse(ayahsData);
        const timestamp = Date.now();
        const srtPath = path.join(__dirname, 'uploads', `sub_${timestamp}.srt`);
        const outputPath = path.join(__dirname, 'uploads', `video_${timestamp}.mp4`);

        let srtContent = '';
        
        // حساب التوقيت التلقائي الذكي لكل آية (5 ثوانٍ لكل آية بناءً على طلبك لتقليل حجم الفيديو وسرعة الرندر)
        const durationPerAyah = 5; 

        ayahs.forEach((ayah, index) => {
            const start = index * durationPerAyah;
            const end = start + durationPerAyah;
            
            // تنظيف النص العربي من أي علامات قد تسبب مشاكل
            const cleanText = ayah.text ? ayah.text.replace(/'/g, "").replace(/"/g, "") : "آية قرآنية";
            
            srtContent += `${index + 1}\n`;
            srtContent += `${formatSRTTime(start)} --> ${formatSRTTime(end)}\n`;
            srtContent += `${cleanText}\n\n`;
        });

        fs.writeFileSync(srtPath, srtContent, 'utf-8');

        const totalDuration = ayahs.length * durationPerAyah;

        // تشغيل FFmpeg لعمل الفيديو بشكل مستقر جداً وبأقل استهلاك للرام
        ffmpeg()
            .input(audioFile.path)
            .inputOptions([`-ss 00:00:00`, `-t ${totalDuration}`]) // يقص من ملف الصوت الكبير على قد مدة الآيات بالظبط
            .input('color=c=0x111827:s=1080x1920') // خلفية داكنة مناسبة للـ Reels
            .inputOptions(['-f lavfi'])
            .complexFilter([
                `[1:v]subtitles=${srtPath.replace(/\\/g, '/')}:force_style='Alignment=2,FontSize=22,Fontname=Arial,PrimaryColour=&HFFFFFF,Outline=1,Shadow=1'[v]`
            ])
            .outputOptions([
                '-map 0:a',          // استخدام الصوت من الملف المرفوع
                '-map [v]',          // استخدام الفيديو الناتج عن الفلتر والنصوص
                '-pix_fmt yuv420p',
                '-c:v libx264',
                '-c:a aac',
                '-shortest'
            ])
            .output(outputPath)
            .on('end', () => {
                // مسح الملفات المؤقتة لتوفير مساحة السيرفر
                if (fs.existsSync(audioFile.path)) fs.unlinkSync(audioFile.path);
                if (fs.existsSync(srtPath)) fs.unlinkSync(srtPath);

                // تحميل الفيديو النهائي لـ n8n
                res.download(outputPath, 'quran_reel.mp4', () => {
                    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
                });
            })
            .on('error', (err) => {
                console.error("FFmpeg error:", err);
                if (fs.existsSync(audioFile.path)) fs.unlinkSync(audioFile.path);
                if (fs.existsSync(srtPath)) fs.unlinkSync(srtPath);
                res.status(500).json({ success: false, error: err.message });
            })
            .run();

    } catch (e) {
        console.error("JSON Parse error:", e);
        if (fs.existsSync(audioFile.path)) fs.unlinkSync(audioFile.path);
        res.status(500).json({ success: false, error: "Invalid ayahs JSON format" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API running on port ${PORT}`));
