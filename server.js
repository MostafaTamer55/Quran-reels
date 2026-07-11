const express = require('express');
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());

// جعل السيرفر يعرض صفحة الويب والصورة كـ Static Files ليقرأها المتصفح الوهمي
app.use(express.static(__dirname));

app.post('/api/make-video', async (req, res) => {
    const { audioUrl, ayahs, surah_id } = req.body;

    if (!audioUrl || !ayahs || ayahs.length === 0) {
        return res.status(400).json({ success: false, message: 'Missing required parameters' });
    }

    const timestamp = Date.now();
    const outputPath = path.join(__dirname, 'uploads', `video_${timestamp}.mp4`);

    if (!fs.existsSync(path.join(__dirname, 'uploads'))) {
        fs.mkdirSync(path.join(__dirname, 'uploads'));
    }

    let browser;
    try {
        const firstAyahNum = parseInt(ayahs[0].numberInSurah || 1);
        
        // حساب توقيت البداية للشاطري ديناميكياً
        let startTimeSeconds = (firstAyahNum - 1) * 5.5; 
        if (parseInt(surah_id) === 2 && firstAyahNum > 10) {
            startTimeSeconds = (firstAyahNum - 1) * 6.2; 
        }

        // 1. تشغيل المتصفح الوهمي (خفيف جداً ومستقر)
        browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const page = await browser.newPage();
        
        // 2. فتح صفحة الويب المحلية لعمل المونتاج بداخلها
        await page.goto(`http://localhost:${process.env.PORT || 3000}/render.html`);

        console.log("Starting Browser-Side Rendering Engine...");

        // 3. حقن وتفعيل دالة الرندر السحرية داخل صفحة الويب
        await page.evaluate(async (url, data, start) => {
            await startRender(url, data, start);
        }, audioUrl, ayahs, startTimeSeconds);

        // 4. الانتظار حتى اكتمال الفيديو وتحويله لـ Base64
        await page.waitForFunction(() => window.renderedVideoBase64 !== undefined, { timeout: 60000 });
        
        const base64Data = await page.evaluate(() => window.renderedVideoBase64);
        const videoBuffer = Buffer.from(base64Data, 'base64');

        // 5. حفظ الفيديو النهائي على السيرفر
        fs.writeFileSync(outputPath, videoBuffer);
        await browser.close();

        // إرسال الفيديو فوراً ونظيفاً لـ n8n
        res.download(outputPath, 'quran_reel.mp4', () => {
            if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
        });

    } catch (e) {
        console.error("Browser Render Error:", e);
        if (browser) await browser.close();
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
        res.status(500).json({ success: false, error: e.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Super Web-Renderer Running on port ${PORT}`));
