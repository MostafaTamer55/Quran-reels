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

// تنظيف ذكي: يمسح فقط علامات الوقف اللي بتعمل مربعات، ويحافظ على التشكيل والألف الخنجرية
function cleanQuranText(text) {
    if (!text) return "آية قرآنية";
    return text
        .replace(/[\u0610-\u0615]/g, "") // حذف علامات الضبط الصغيرة
        .replace(/[\u06D6-\u06ED]/g, "") // حذف علامات الوقف العثمانية (المسببة للمربعات)
        .replace(/\s+/g, " ")
        .trim();
}

app.post('/api/make-video', async (req, res) => {
    let { audioUrl, ayahs, surah_id } = req.body;

    if (Array.isArray(audioUrl)) audioUrl = audioUrl[0];
    if (typeof audioUrl === 'string') audioUrl = audioUrl.replace(/[\[\]]/g, '').trim();

    if (!audioUrl || !ayahs || ayahs.length === 0) {
        return res.status(400).json({ success: false, message: 'Invalid or missing parameters' });
    }

    const timestamp = Date.now();
    const srtPath = path.join(__dirname, 'uploads', `sub_${timestamp}.srt`);
    const outputPath = path.join(__dirname, 'uploads', `video_${timestamp}.mp4`);
    const bgImagePath = path.join(__dirname, 'background.jpg'); 
    const localFontPath = path.join(__dirname, 'Amiri-Regular.ttf'); 

    if (!fs.existsSync(path.join(__dirname, 'uploads'))) {
        fs.mkdirSync(path.join(__dirname, 'uploads'));
    }

    try {
        // قراءة التوقيتات الحقيقية بالملي ثانية مباشرة من الـ API الممرر من n8n
        // الـ API بيبعت الحقول دي لكل آية: audio_start و audio_end (أو ما يماثلها، تأكد منها في نود n8n)
        let startTimeSeconds = ayahs[0].audio_start ? (parseFloat(ayahs[0].audio_start) / 1000) : null;
        let endTimeSeconds = ayahs[ayahs.length - 1].audio_end ? (parseFloat(ayahs[ayahs.length - 1].audio_end) / 1000) : null;

        const firstAyahNum = parseInt(ayahs[0].numberInSurah || 1);

        // fallback لو الحقول مش موجودة بنفس الاسم بالظبط
        if (startTimeSeconds === null) {
            startTimeSeconds = (firstAyahNum - 1) * 6.4; 
            if (parseInt(surah_id) === 2) {
                if (firstAyahNum <= 5) startTimeSeconds = (firstAyahNum - 1) * 7.5;
                else if (firstAyahNum > 5 && firstAyahNum <= 15) startTimeSeconds = 35 + (firstAyahNum - 5) * 5.8;
                else if (firstAyahNum >= 40 && firstAyahNum <= 50) startTimeSeconds = 248 + (firstAyahNum - 40) * 6.5;
                else startTimeSeconds = (firstAyahNum - 1) * 6.2;
            }
        }

        const durationPerAyah = 6;
        const totalDuration = endTimeSeconds ? (endTimeSeconds - startTimeSeconds) : (ayahs.length * durationPerAyah);

        // بناء ملف الـ SRT بناءً على توقيتات الآيات الحقيقية
        let srtContent = '';
        ayahs.forEach((ayah, index) => {
            let start = ayah.audio_start ? (parseFloat(ayah.audio_start) / 1000) - startTimeSeconds : index * durationPerAyah;
            let end = ayah.audio_end ? (parseFloat(ayah.audio_end) / 1000) - startTimeSeconds : (index + 1) * durationPerAyah;

            start = Math.max(0, start);
            let cleanText = cleanQuranText(ayah.text);

            srtContent += `${index + 1}\n`;
            srtContent += `${formatSRTTime(start)} --> ${formatSRTTime(end)}\n`;
            srtContent += `${cleanText}\n\n`;
        });

        fs.writeFileSync(srtPath, '\ufeff' + srtContent, 'utf-8');

        let command = ffmpeg().input(audioUrl).inputOptions([`-ss ${startTimeSeconds}`, `-t ${totalDuration}`]);

        if (fs.existsSync(bgImagePath)) {
            command.input(bgImagePath).inputOptions(['-loop 1', `-t ${totalDuration}`]);
        } else {
            command.input('color=c=0x111827:s=720x1280:r=25').inputOptions(['-f lavfi', `-t ${totalDuration}`]);
        }

        // استخدام الخط المحلي Amiri-Regular.ttf اللي رفعناه لمنع المربعات مع التشكيل
        let fontStyle = '';
        if (fs.existsSync(localFontPath)) {
            fontStyle = `,Fontname=Amiri,Fontfile=${localFontPath.replace(/\\/g, '/')}`;
        }

        command
            .complexFilter([
                `[1:v]scale=720:1280,subtitles=${srtPath.replace(/\\/g, '/')}:force_style='Alignment=2,Fontsize=22,PrimaryColour=&HFFFFFF,Outline=2,OutlineColour=&H000000,MarginV=140,WrapStyle=0${fontStyle}'[v]`
            ])
            .outputOptions(['-map 0:a', '-map [v]', '-pix_fmt yuv420p', '-c:v libx264', '-preset ultrafast', '-c:a aac', '-shortest'])
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
app.listen(PORT, () => console.log(`Quran Reels Generator Running on port ${PORT}`));
