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
    const localFontPath = path.join(__dirname, 'Amiri-Regular.ttf'); 

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

        let srtContent = '';
        ayahs.forEach((ayah, index) => {
            const start = index * durationPerAyah;
            const end = start + durationPerAyah;
            srtContent += `${index + 1}\n${formatSRTTime(start)} --> ${formatSRTTime(end)}\n${ayah.text}\n\n`;
        });

        fs.writeFileSync(srtPath, '\ufeff' + srtContent, 'utf-8');

        let command = ffmpeg().input(audioUrl).inputOptions([`-ss ${startTimeSeconds}`, `-t ${totalDuration}`]);

        if (fs.existsSync(bgImagePath)) {
            command.input(bgImagePath).inputOptions(['-loop 1', `-t ${totalDuration}`]);
        } else {
            command.input('color=c=0x111827:s=720x1280:r=25').inputOptions(['-f lavfi', `-t ${totalDuration}`]);
        }

        // تم تصحيح الفلتر بالكامل ليكون متوافقاً مع معايير نظام Linux (Fontsize بحرف صغير)
        let fontStyle = '';
        if (fs.existsSync(localFontPath)) {
            fontStyle = `,Fontname=Amiri,Fontfile=${localFontPath.replace(/\\/g, '/')}`;
        }

        command
            .complexFilter([
                `[1:v]scale=720:1280,subtitles=${srtPath.replace(/\\/g, '/')}:force_style='Alignment=2,Fontsize=22,PrimaryColour=&HFFFFFF,Outline=2,OutlineColour=&H000000${fontStyle}'[v]`
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
