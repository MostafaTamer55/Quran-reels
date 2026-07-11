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

function stripTashkeel(text) {
    if (!text) return "آية قرآنية";
    return text
        .replace(/[\u064B-\u065F]/g, "") 
        .replace(/[\u0610-\u0615]/g, "") 
        .replace(/[\u06D6-\u06ED]/g, "") 
        .replace(/ٰ/g, "")               
        .replace(/[^\u0600-\u06FF\s]/g, "") 
        .replace(/\s+/g, " ")
        .trim();
}

app.post('/api/make-video', async (req, res) => {
    let { audioUrl, ayahs, surah_id } = req.body;

    // تنظيف وتنقية رابط الصوت لو جاي بالخطأ كـ مصفوفة أو نص معقد من n8n
    if (Array.isArray(audioUrl)) {
        audioUrl = audioUrl[0];
    }
    if (typeof audioUrl === 'string') {
        audioUrl = audioUrl.replace(/[\[\]]/g, '').trim();
    }

    if (!audioUrl || !audioUrl.startsWith('http') || !ayahs || ayahs.length === 0) {
        return res.status(400).json({ success: false, message: 'Invalid or missing parameters', receivedUrl: audioUrl });
    }

    const timestamp = Date.now();
    const outputPath = path.join(__dirname, 'uploads', `video_${timestamp}.mp4`);

    if (!fs.existsSync(path.join(__dirname, 'uploads'))) {
        fs.mkdirSync(path.join(__dirname, 'uploads'));
    }

    try {
        const firstAyahNum = parseInt(ayahs[0].numberInSurah || 1);
        
        let startTimeSeconds = (firstAyahNum - 1) * 6.4; 
        if (parseInt(surah_id) === 2) {
            if (firstAyahNum <= 5) startTimeSeconds = (firstAyahNum - 1) * 7.5;
            else if (firstAyahNum > 5 && firstAyahNum <= 15) startTimeSeconds = 35 + (firstAyahNum - 5) * 5.8;
            else startTimeSeconds = (firstAyahNum - 1) * 6.2;
        }

        const durationPerAyah = 6; 
        const totalDuration = ayahs.length * durationPerAyah;

        // تحديد مسار خط النظام الافتراضي في سيرفرات الـ Linux لضمان القراءة
        const fontPath = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
        const fontSetting = fs.existsSync(fontPath) ? `:fontfile=${fontPath}` : '';

        let filters = [];
        filters.push(`color=c=0x111827:s=720x1280:r=25:d=${totalDuration}[bg]`);

        let currentInput = '[bg]';

        ayahs.forEach((ayah, index) => {
            const start = index * durationPerAyah;
            const end = start + durationPerAyah;
            const cleanText = stripTashkeel(ayah.text);
            const outputLabel = `v${index}`;

            filters.push(
                `${currentInput}drawtext=text='${cleanText}':fontcolor=white:fontsize=24:x=(w-text_w)/2:y=(h-text_h)/2${fontSetting}:enable='between(t,${start},${end})'[${outputLabel}]`
            );
            currentInput = `[${outputLabel}]`;
        });

        let command = ffmpeg().input(audioUrl);
        command.inputOptions([`-ss ${startTimeSeconds}`, `-t ${totalDuration}`]);

        command
            .complexFilter(filters, currentInput)
            .outputOptions([
                '-pix_fmt yuv420p',
                '-c:v libx264',
                '-preset ultrafast',
                '-c:a aac',
                '-shortest'
            ])
            .output(outputPath)
            .on('end', () => {
                res.download(outputPath, 'quran_reel.mp4', () => {
                    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
                });
            })
            .on('error', (err) => {
                console.error("FFmpeg error:", err);
                if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
                res.status(500).json({ success: false, error: err.message });
            })
            .run();

    } catch (e) {
        console.error("Error:", e);
        res.status(500).json({ success: false, error: e.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Solid Video Generator Running on port ${PORT}`));
