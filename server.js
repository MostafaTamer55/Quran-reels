const express = require('express');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());

// دالة تنظيف علامات الوقف العثمانية الصعبة اللي بتعمل مربعات، مع الحفاظ على التشكيل كاملاً
function cleanQuranText(text) {
    if (!text) return "آية قرآنية";
    return text
        .replace(/[\u0610-\u0615]/g, "") // حذف علامات الضبط الصغيرة جداً
        .replace(/[\u06D6-\u06ED]/g, "") // حذف علامات الوقف العثمانية (صلى، قلى، ج، م) المسببة للمربعات
        .replace(/ٰ/g, "ا")             // تحويل الألف الخنجرية لألف عادية لسلامة الخط
        .replace(/\s+/g, " ")
        .trim();
}

app.post('/api/make-video', async (req, res) => {
    let { audioUrl, ayahs, surah_id } = req.body;

    if (Array.isArray(audioUrl)) audioUrl = audioUrl[0];
    if (typeof audioUrl === 'string') audioUrl = audioUrl.replace(/[\[\]]/g, '').trim();

    if (!audioUrl || !audioUrl.startsWith('http') || !ayahs || ayahs.length === 0) {
        return res.status(400).json({ success: false, message: 'Invalid or missing parameters' });
    }

    const timestamp = Date.now();
    const outputPath = path.join(__dirname, 'uploads', `video_${timestamp}.mp4`);
    const bgImagePath = path.join(__dirname, 'background.jpg'); 

    if (!fs.existsSync(path.join(__dirname, 'uploads'))) {
        fs.mkdirSync(path.join(__dirname, 'uploads'));
    }

    try {
        const firstAyahNum = parseInt(ayahs[0].numberInSurah || 1);
        
        // حساب توقيت البداية بدقة بناءً على رقم الآية وسورة البقرة
        let startTimeSeconds = (firstAyahNum - 1) * 6.4; 
        if (parseInt(surah_id) === 2) {
            if (firstAyahNum <= 5) startTimeSeconds = (firstAyahNum - 1) * 7.5;
            else if (firstAyahNum > 5 && firstAyahNum <= 15) startTimeSeconds = 35 + (firstAyahNum - 5) * 5.8;
            else if (firstAyahNum >= 40 && firstAyahNum <= 50) startTimeSeconds = 248 + (firstAyahNum - 40) * 6.5; // ضبط مخصص للآية 47 بالملي
            else startTimeSeconds = (firstAyahNum - 1) * 6.2;
        }

        // التوقيت الديناميكي المرن بناءً على طول الآية (متوسط 0.12 ثانية لكل حرف)
        let totalDuration = 0;
        let ayahTimings = [];

        ayahs.forEach((ayah) => {
            const cleanText = cleanQuranText(ayah.text);
            // حساب المدة: عدد الحروف مضروب في 0.12 ثانية (على ألا تقل عن 5 ثوانٍ ولا تزيد عن 12 ثانية للآية)
            let duration = Math.max(5, Math.min(12, cleanText.length * 0.12));
            
            ayahTimings.push({
                text: cleanText,
                start: totalDuration,
                end: totalDuration + duration
            });
            totalDuration += duration;
        });

        let filters = [];
        // بناء الخلفية (الصورة أو اللون الافتراضي)
        if (fs.existsSync(bgImagePath)) {
            filters.push(`[1:v]scale=720:1280,loop=loop=-1:size=1:start=0[bg_scaled]`);
        } else {
            filters.push(`color=c=0x111827:s=720x1280:r=25:d=${totalDuration}[bg_scaled]`);
        }

        let currentInput = '[bg_scaled]';

        // رسم النصوص أوتوماتيك بـ drawtext مع تقسيم السطور الذكي لمنع خروج الكلام بره الشاشة
        ayahTimings.forEach((ayah, index) => {
            const outputLabel = `v${index}`;
            
            // تقسيم النص لنصفين لو كان طويلاً جداً عشان ينزل على سطرين شيك
            let textParam = ayah.text;
            if (textParam.length > 40) {
                const middle = Math.floor(textParam.length / 2);
                const spaceIndex = textParam.indexOf(' ', middle);
                if (spaceIndex !== -1) {
                    textParam = textParam.substring(0, spaceIndex) + '\n' + textParam.substring(spaceIndex + 1);
                }
            }

            filters.push(
                `${currentInput}drawtext=text='${textParam}':fontcolor=white:fontsize=26:line_spacing=15:x=(w-text_w)/2:y=(h-text_h)/2:enable='between(t,${ayah.start},${ayah.end})'[${outputLabel}]`
            );
            currentInput = `[${outputLabel}]`;
        });

        let command = ffmpeg().input(audioUrl).inputOptions([`-ss ${startTimeSeconds}`, `-t ${totalDuration}`]);
        if (fs.existsSync(bgImagePath)) {
            command.input(bgImagePath);
        }

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
app.listen(PORT, () => console.log(`Quran Reels Generator Running on port ${PORT}`));
