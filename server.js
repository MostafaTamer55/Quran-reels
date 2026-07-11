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

// دالة إجبارية لتنظيف النص تماماً من التشكيل العثماني لمنع المربعات [] نهائياً
function stripTashkeel(text) {
    if (!text) return "آية قرآنية";
    return text
        .replace(/[\u064B-\u065F]/g, "") // حذف التشكيل (فتحة، ضمة، كسرة، سكون)
        .replace(/[\u0610-\u0615]/g, "") // حذف علامات الضبط
        .replace(/[\u06D6-\u06ED]/g, "") // حذف علامات الوقف (ج، صلى، قلى)
        .replace(/ٰ/g, "")               // حذف الألف الخنجرية
        .replace(/[^\u0600-\u06FF\s]/g, "") // حذف أي رموز غريبة خارج الحروف العربية
        .replace(/\s+/g, " ")
        .trim();
}

app.post('/api/make-video', async (req, res) => {
    const { audioUrl, ayahs, surah_id } = req.body;

    if (!audioUrl || !ayahs || ayahs.length === 0) {
        return res.status(400).json({ success: false, message: 'Missing required parameters' });
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
        
        // حساب التوقيت بدقة للقطع أونلاين
        let startTimeSeconds = (firstAyahNum - 1) * 6.4; 
        
        if (parseInt(surah_id) === 2) {
            if (firstAyahNum <= 5) startTimeSeconds = (firstAyahNum - 1) * 7.5;
            else if (firstAyahNum > 5 && firstAyahNum <= 15) startTimeSeconds = 35 + (firstAyahNum - 5) * 5.8;
            else startTimeSeconds = (firstAyahNum - 1) * 6.2;
        }

        const durationPerAyah = 6; 
        const totalDuration = ayahs.length * durationPerAyah;

        let srtContent = '';
        ayahs.forEach((ayah, index) => {
            const start = index * durationPerAyah;
            const end = start + durationPerAyah;
            
            let cleanText = stripTashkeel(ayah.text);
            
            srtContent += `${index + 1}\n`;
            srtContent += `${formatSRTTime(start)} --> ${formatSRTTime(end)}\n`;
            srtContent += `${cleanText}\n\n`;
        });

        // حفظ بترميز UTF-8 نظيف بدون الـ BOM المعقد لـ Linux FFmpeg
        fs.writeFileSync(srtPath, srtContent, 'utf-8');

        let command = ffmpeg().input(audioUrl);
        command.inputOptions([`-ss ${startTimeSeconds}`, `-t ${totalDuration}`]);

        if (fs.existsSync(bgImagePath)) {
            command.input(bgImagePath).inputOptions(['-loop 1', `-t ${totalDuration}`]);
        } else {
            command.input('color=c=0x111827:s=720x1280:r=25').inputOptions(['-f lavfi', `-t ${totalDuration}`]);
        }

        command
            .complexFilter([
                // شلنا شرط Fontname تماماً عشان السيرفر يختار الخط العربي الافتراضي بدون كراش
                `[1:v]scale=720:1280,subtitles=${srtPath.replace(/\\/g, '/')}:force_style='Alignment=2,FontSize=24,PrimaryColour=&HFFFFFF,Outline=2,OutlineColour=&H000000'[v]`
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
app.listen(PORT, () => console.log(`FFmpeg Video Generator Running on port ${PORT}`));
