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

// دالة سحرية لتنظيف النص من علامات الوقف العثمانية التي تسبب ظهور المربعات []
function cleanArabicText(text) {
    if (!text) return "آية قرآنية";
    return text
        .replace(/[\u0610-\u0615]/g, '') // علامات الضبط والوقف الصغيرة
        .replace(/[\u06D6-\u06ED]/g, '') // علامات وقف المصحف (ج، قلى، صلى، م، لا)
        .replace(/'/g, "")
        .replace(/"/g, "")
        .trim();
}

app.post('/api/make-video', async (req, res) => {
    const { audioUrl, ayahs } = req.body;

    if (!audioUrl || !ayahs) {
        return res.status(400).json({ success: false, message: 'Missing audioUrl or ayahs data' });
    }

    const timestamp = Date.now();
    const srtPath = path.join(__dirname, 'uploads', `sub_${timestamp}.srt`);
    const outputPath = path.join(__dirname, 'uploads', `video_${timestamp}.mp4`);
    const bgImagePath = path.join(__dirname, 'background.png'); 

    if (!fs.existsSync(path.join(__dirname, 'uploads'))) {
        fs.mkdirSync(path.join(__dirname, 'uploads'));
    }

    try {
        let srtContent = '';
        
        // محاولة جلب التوقيت الحقيقي للآية الأولى من الـ الـ API لضبط تطابق الصوت
        // الـ API في موقع quran2reels بيبعت التوقيت في حقل "seconds" أو "start_time" داخل الـ JSON
        let startTimeSeconds = 0;
        
        if (ayahs[0] && (ayahs[0].start_time !== undefined || ayahs[0].seconds !== undefined)) {
            startTimeSeconds = ayahs[0].start_time || ayahs[0].seconds;
        } else {
            // كحل بديل إذا لم يتوفر التوقيت: حساب تقريبي بناءً على رقم الآية الحالية (الآية * متوسط 5 ثوانٍ)
            const fromAyah = ayahs[0].numberInSurah || 1;
            startTimeSeconds = (fromAyah - 1) * 6; 
        }

        const durationPerAyah = 6; // مدة ظهور كل آية
        let totalDuration = 0;

        ayahs.forEach((ayah, index) => {
            const start = index * durationPerAyah;
            const end = start + durationPerAyah;
            totalDuration += durationPerAyah;

            // تنظيف النص فوراً قبل كتابته في ملف الترجمة
            let cleanText = cleanArabicText(ayah.text);
            
            srtContent += `${index + 1}\n`;
            srtContent += `${formatSRTTime(start)} --> ${formatSRTTime(end)}\n`;
            srtContent += `${cleanText}\n\n`;
        });

        fs.writeFileSync(srtPath, '\ufeff' + srtContent, 'utf-8');

        let command = ffmpeg().input(audioUrl);
        
        // هنا السر! نقص من ملف الصوت الكبير بناءً على وقت بداية الآيات الحقيقي
        command.inputOptions([`-ss ${startTimeSeconds}`, `-t ${totalDuration}`]);

        if (fs.existsSync(bgImagePath)) {
            command.input(bgImagePath).inputOptions(['-loop 1', `-t ${totalDuration}`]);
        } else {
            command.input('color=c=0x111827:s=1080x1920:r=25').inputOptions(['-f lavfi', `-t ${totalDuration}`]);
        }

        command
            .complexFilter([
                `[1:v]subtitles=${srtPath.replace(/\\/g, '/')}:force_style='Alignment=2,FontSize=22,Fontname=Arial,PrimaryColour=&HFFFFFF,Outline=2,OutlineColour=&H000000'[v]`
            ])
            .outputOptions([
                '-map 0:a',          
                '-map [v]',          
                '-pix_fmt yuv420p',
                '-c:v libx264',
                '-preset ultrafast',
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
app.listen(PORT, () => console.log(`API running on port ${PORT}`));
