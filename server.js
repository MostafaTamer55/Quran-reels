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

// دالة قوية جداً لتنظيف النص تماماً من أي تشكيل أو رموز مصحفية تسبب المربعات []
function removeAllTashkeel(text) {
    if (!text) return "آية قرآنية";
    return text
        .replace(/[\u064B-\u065F]/g, "") // حذف التشكيل العادي (فتحة، ضمة، كسرة، سكون...)
        .replace(/[\u0610-\u0615]/g, "") // حذف علامات الضبط
        .replace(/[\u06D6-\u06ED]/g, "") // حذف علامات الوقف المصحفية (ج، صلى، قلى...)
        .replace(/إ/g, "ا").replace(/أ/g, "ا").replace(/آ/g, "ا") // توحيد الألفات لمنع تشتت الخط
        .replace(/ٰ/g, "") // حذف الألف الخنجرية
        .replace(/[^\u0600-\u06FF\s]/g, "") // حذف أي رمز ليس حرفاً عربياً أو مسافة
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
    
    // البحث عن الخلفية بكافة الامتدادات الممكنة لضمان القراءة
    let bgImagePath = path.join(__dirname, 'background.jpg');
    if (!fs.existsSync(bgImagePath)) {
        bgImagePath = path.join(__dirname, 'background.png');
    }

    if (!fs.existsSync(path.join(__dirname, 'uploads'))) {
        fs.mkdirSync(path.join(__dirname, 'uploads'));
    }

    try {
        const firstAyahNum = parseInt(ayahs[0].numberInSurah || 1);
        
        // حساب توقيت البداية ديناميكياً: متوسط الشيخ الشاطري في الآية هو 5.5 ثوانٍ
        // لو واصلين للآية 21 مثلاً، يبدأ القطع من الثانية (20 * 5.5) = 110 ثانية جوه السورة
        let startTimeSeconds = (firstAyahNum - 1) * 5.5; 
        
        // تعديل يدوي ذكي للبقرة لو الآيات متأخرة
        if (parseInt(surah_id) === 2 && firstAyahNum > 10) {
            startTimeSeconds = (firstAyahNum - 1) * 6.2; 
        }

        const durationPerAyah = 6; // مدة بقاء النص
        const totalDuration = ayahs.length * durationPerAyah;

        let srtContent = '';
        ayahs.forEach((ayah, index) => {
            const start = index * durationPerAyah;
            const end = start + durationPerAyah;
            
            // تنظيف كامل للنص ليكون حروفاً واضحة بدون مربعات
            let cleanText = removeAllTashkeel(ayah.text);
            
            srtContent += `${index + 1}\n`;
            srtContent += `${formatSRTTime(start)} --> ${formatSRTTime(end)}\n`;
            srtContent += `${cleanText}\n\n`;
        });

        fs.writeFileSync(srtPath, '\ufeff' + srtContent, 'utf-8');

        let command = ffmpeg().input(audioUrl);
        command.inputOptions([`-ss ${startTimeSeconds}`, `-t ${totalDuration}`]);

        // إجبار تشغيل الصورة
        if (fs.existsSync(bgImagePath)) {
            console.log("Background image found:", bgImagePath);
            command.input(bgImagePath).inputOptions(['-loop 1', `-t ${totalDuration}`]);
        } else {
            console.log("No background found, using solid color.");
            command.input('color=c=0x111827:s=720x1280:r=15').inputOptions(['-f lavfi', `-t ${totalDuration}`]);
        }

        command
            .complexFilter([
                // دمج الفلتر مع إجبار الفريمات والأبعاد المتوافقة مع الرام والصورة
                `[1:v]scale=720:1280,subtitles=${srtPath.replace(/\\/g, '/')}:force_style='Alignment=2,FontSize=20,Fontname=Arial,PrimaryColour=&HFFFFFF,Outline=2,OutlineColour=&H000000'[v]`
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
