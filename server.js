const express = require('express');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');
const axios = require('axios'); // للتواصل السريع مع الـ API الخارجي

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

// دالة تنظيف النص من علامات الوقف والمربعات الغريبة []
function cleanArabicText(text) {
    if (!text) return "آية قرآنية";
    return text
        .replace(/[\u0610-\u0615]/g, '') // علامات الضبط والوقف الصغيرة
        .replace(/[\u06D6-\u06ED]/g, '') // علامات وقف المصحف بالكامل
        .replace(/'/g, "")
        .replace(/"/g, "")
        .replace(/ۛ/g, "")
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
    const bgImagePath = path.join(__dirname, 'background.png'); 

    if (!fs.existsSync(path.join(__dirname, 'uploads'))) {
        fs.mkdirSync(path.join(__dirname, 'uploads'));
    }

    try {
        const surahNumber = surah_id || 2; // رقم السورة الافتراضي
        const firstAyahNum = ayahs[0].numberInSurah;
        const lastAyahNum = ayahs[ayahs.length - 1].numberInSurah;

        let startTimeSeconds = 0;
        let totalDuration = ayahs.length * 6; // افتراضي 6 ثواني لكل آية في حالة الفشل

        try {
            // جلب التوقيت الدقيق جداً لأبو بكر الشاطري أونلاين بناءً على السورة
            const timingResponse = await axios.get(`https://api.quran.com/api/v4/recitations/7/by_ayah/${surahNumber}:${firstAyahNum}`);
            if (timingResponse.data && timingResponse.data.audio_files && timingResponse.data.audio_files[0]) {
                const audioFile = timingResponse.data.audio_files[0];
                // حساب وقت البداية من حقل الـ segments الحقيقي بالملي ثانية
                if (audioFile.segments && audioFile.segments[0]) {
                    startTimeSeconds = audioFile.segments[0][1] / 1000; // تحويل لثواني
                }
            }
        } catch (err) {
            console.log("Timing API failed, using backup calculation.");
            startTimeSeconds = (firstAyahNum - 1) * 5.8; // حساب تقريبي ذكي جداً
        }

        let srtContent = '';
        const durationPerAyah = 6; 

        ayahs.forEach((ayah, index) => {
            const start = index * durationPerAyah;
            const end = start + durationPerAyah;
            
            let cleanText = cleanArabicText(ayah.text);
            
            srtContent += `${index + 1}\n`;
            srtContent += `${formatSRTTime(start)} --> ${formatSRTTime(end)}\n`;
            srtContent += `${cleanText}\n\n`;
        });

        // حفظ بترميز UTF-8 مع الـ BOM لمنع الحروف المتقطعة نهائياً في FFmpeg
        fs.writeFileSync(srtPath, '\ufeff' + srtContent, 'utf-8');

        let command = ffmpeg().input(audioUrl);
        
        // التقطيع من مكان الآيات الحقيقي بالظبط
        command.inputOptions([`-ss ${startTimeSeconds}`, `-t ${totalDuration}`]);

        if (fs.existsSync(bgImagePath)) {
            command.input(bgImagePath).inputOptions(['-loop 1', `-t ${totalDuration}`]);
        } else {
            command.input('color=c=0x111827:s=1080x1920:r=25').inputOptions(['-f lavfi', `-t ${totalDuration}`]);
        }

        command
            .complexFilter([
                // دمج الترجمة وحل مشكلة الخطوط والمربعات
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
