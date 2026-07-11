// تشغيل FFmpeg بأعلى سرعة وأقل استهلاك رام أونلاين
        ffmpeg()
            .input(audioUrl)
            .inputOptions([
                '-reconnect 1',
                '-reconnect_streamed 1',
                '-reconnect_delay_max 5',
                '-ss 00:00:00', 
                `-t ${totalDuration}`
            ])
            .input('color=c=0x111827:s=1080x1920') 
            .inputOptions(['-f lavfi'])
            .complexFilter([
                `[1:v]subtitles=${srtPath.replace(/\\/g, '/')}:force_style='Alignment=2,FontSize=22,Fontname=Arial,PrimaryColour=&HFFFFFF,Outline=1,Shadow=1'[v]`
            ])
            .outputOptions([
                '-map 0:a',          
                '-map [v]',          
                '-pix_fmt yuv420p',
                '-c:v libx264',
                '-c:a aac',
                '-shortest'
            ])
            .output(outputPath)
            .on('end', () => {
                if (fs.existsSync(srtPath)) fs.unlinkSync(srtPath);

                // تحميل الفيديو النهائي لـ n8n
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
