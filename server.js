const express = require('express');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());

// دالة تحويل الثواني لتنسيق SRT الاحترافي الممسوح منه أي مشاكل
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
    const bgVideoPath = path.join(__dirname, 'background.mp4'); // مسار فيديو الخلفية

    if (!fs.existsSync(path.join(__dirname, 'uploads'))) {
        fs.mkdirSync(path.join(__dirname, 'uploads'));
    }

    try {
        let srtContent = '';
        
        // جلب توقيت البداية والنهاية الحقيقي من أول آية لضمان تطابق الصوت
        // إذا كان الـ API يرسل التوقيت بالثواني في حقل start_time أو audio_timestamps
        let startTime = ayahs[0].start_time || 0; 
        let totalDuration = 0;
        
        const durationPerAyah = 6; // مدة افتراضية إذا لم يتوفر توقيت لكل آية

        ayahs.forEach((ayah, index) => {
            const start = index * durationPerAyah;
            const end = start + durationPerAyah;
            totalDuration += durationPerAyah;

            // تنظيف النص وضمان إرساله بشكل سليم للـ SRT
            let cleanText = ayah.text ? ayah.text.trim() : "";
            
            srtContent += `${index + 1}\n`;
            srtContent += `${formatSRTTime(start)} --> ${formatSRTTime(end)}\n`;
            srtContent += `${cleanText}\n\n`;
        });

        // حفظ ملف الترجمة بترميز UTF-8 مع الـ BOM لحل مشكلة الحروف المتقطعة في العربي
        fs.writeFileSync(srtPath, '\ufeff' + srtContent, 'utf-8');

        // تحديد المدخلات: إذا وجد فيديو خلفيةbackground.mp4 سيستخدمه، وإلا سيستخدم الخلفية السوداء الافتراضية
        let command = ffmpeg().input(audioUrl);
        
        // لتطابق الصوت: نقص من ملف الصوت الكبير من بداية وقت الآيات الحقيقي
        command.inputOptions([`-ss ${startTime}`, `-t ${totalDuration}`]);

        if (fs.existsSync(bgVideoPath)) {
            command.input(bgVideoPath).inputOptions(['-stream_loop -1']); // تكرار فيديو الخلفية لو قصير
        } else {
            command.input('color=c=0x111827:s=720x1280:r=24').inputOptions(['-f lavfi']);
        }

        command
            .complexFilter([
                // دمج الترجمة وضبط الخط ليظهر بشكل صحيح متصل Alignment=2 (في المنتصف أسفل)
                `[1:v]subtitles=${srtPath.replace(/\\/g, '/')}:force_style='Alignment=2,FontSize=20,Fontname=Arial,PrimaryColour=&HFFFFFF,Outline=2,OutlineColour=&H000000'[v]`
            ])
            .outputOptions([
                '-map 0:a',          
                '-map [v]',          
                '-pix_fmt yuv420p',
                '-c:v libx264',
                '-preset ultrafast',
                '-c:a aac',
                `-t ${totalDuration}`,
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
