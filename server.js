const express = require('express');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');

const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(express.json());

app.post('/api/make-video', upload.single('audio'), (req, res) => {
    const audioFile = req.file;
    const ayahsData = req.body.ayahs;

    if (!audioFile || !ayahsData) {
        return res.status(400).json({ success: false, message: 'Missing audio or ayahs data' });
    }

    const ayahs = JSON.parse(ayahsData);
    const outputPath = path.join(__dirname, 'uploads', `video_${Date.now()}.mp4`);

    // هنا بنستخدم FFmpeg لتركيب النص فوق الصوت مع خلفية سوداء مخصصة للـ Reels
    // سكريبت الـ Drawtext لتركيب نصوص الآيات ديناميكياً بناءً على التوقيت
    let filterString = "color=s=1080x1920:c=0x111827[bg];";
    
    // حساب تقسيم الآيات بالتساوي بناءً على عددها كمثال مبدئي
    // (تقدر تربطها بالـ timing الـ جاي من الـ API بدقة لاحقاً)
    const durationPerAyah = 4; 

    ayahs.forEach((ayah, index) => {
        const start = index * durationPerAyah;
        const end = start + durationPerAyah;
        // تنظيف النص من أي علامات قد تبوظ أمر الـ FFmpeg
        const cleanText = ayah.text.replace(/'/g, "").replace(/"/g, "");
        
        filterString += `[bg]drawtext=text='${cleanText}':fontcolor=white:fontsize=48:x=(w-text_w)/2:y=(h-text_h)/2:enable='between(t,${start},${end})'[bg];`;
    });

    // إزالة آخر سيميكولون وتسمية المخرج النهائي
    filterString = filterString.slice(0, -1);

    ffmpeg()
        .input(audioFile.path)
        .inputOptions(['-f lavfi', '-i color=c=black:s=1080x1920']) // خلفية افتراضية لو الصوت طويل
        .complexFilter(filterString)
        .outputOptions(['-pix_fmt yuv420p', '-c:v libx264', '-c:a aac', '-shortest'])
        .output(outputPath)
        .on('end', () => {
            // مسح ملف الصوت المؤقت
            fs.unlinkSync(audioFile.path);

            // إرسال الفيديو النهائي لـ n8n
            res.download(outputPath, 'quran_reel.mp4', () => {
                fs.unlinkSync(outputPath); // مسح الفيديو بعد التحميل لتنظيف السيرفر
            });
        })
        .on('error', (err) => {
            console.error(err);
            res.status(500).json({ success: false, error: err.message });
        })
        .run();
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => console.log(`API running on port ${PORT}`));
