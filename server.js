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

app.post('/api/make-video', async (req, res) => {
    const { audioUrl, ayahs } = req.body;

    if (!audioUrl || !ayahs) {
        return res.status(400).json({ success: false, message: 'Missing audioUrl or ayahs data' });
    }

    const timestamp = Date.now();
    const srtPath = path.join(__dirname, 'uploads', `sub_${timestamp}.srt`);
    const outputPath = path.join(__dirname, 'uploads', `video_${timestamp}.mp4`);

    if (!fs.existsSync(path.join(__dirname, 'uploads'))) {
        fs.mkdirSync(path.join(__dirname, 'uploads'));
    }

    try {
        let srtContent = '';
        
        // حساب التوقيتات بناءً على ترتيب الـ 5 آيات المبعوثة (مثلاً 6 ثوانٍ لكل آية)
        const durationPerAyah = 6; 

        ayahs.forEach((ayah, index) => {
            const start = index * durationPerAyah;
            const end = start + durationPerAyah;
            const cleanText = ayah.text ? ayah.text.replace(/'/g, "").replace(/"/g, "") : "آية قرآنية";
            
            srtContent += `${index + 1}\n`;
            srtContent += `${formatSRTTime(start)} --> ${formatSRTTime(end)}\n`;
            srtContent += `${cleanText}\n\n`;
        });

        fs.writeFileSync(srtPath, srtContent, 'utf-8');
        const totalDuration = ayahs.length * durationPerAyah;

        // تشغيل FFmpeg بنظام الـ Stream الخفيف للقص المباشر أونلاين
        ffmpeg()
            .input(audioUrl)
            .inputOptions([
                '-ss 00:00:00', // يمكنك استبدالها بوقت بداية الآيات الحقيقي لو متوفر في الـ JSON
                `-t ${totalDuration}`
            ])
            .input('color=c=0x111827:s=720x1280:r=24') // جودة HD خفيفة وممتازة للـ Reels وتوفر الرام
            .inputOptions(['-f lavfi'])
            .complexFilter([
                `[1:v]subtitles=${srtPath.replace(/\\/g, '/')}:force_style='Alignment=2,FontSize=18,Fontname=Arial,PrimaryColour=&HFFFFFF,Outline=1,Shadow=1'[v]`
            ])
            .outputOptions([
                '-map 0:a',          
                '-map [v]',          
                '-pix_fmt yuv420p',
                '-c:v libx264',
                '-preset ultrafast', // يمنع الـ Timeout تماماً بجعل الرندر فوري
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
