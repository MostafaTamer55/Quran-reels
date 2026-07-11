// توليد ملف الترجمة وحساب التوقيتات بدقة من الـ API
let srtContent = '';
let startTimeForCut = 0;
let endTimeForCut = 0;

ayahs.forEach((ayah, index) => {
    // تحويل التوقيت من الـ API (غالبا بالملي ثانية أو الثواني)
    // لو الـ API بيبعت ثانية البداية والنهاية، هنستخدمهم مباشرة:
    const start = ayah.start_time || (index * 4); 
    const end = ayah.end_time || (start + 4);

    if (index === 0) startTimeForCut = start;
    if (index === ayahs.length - 1) endTimeForCut = end;

    srtContent += `${index + 1}\n`;
    srtContent += `${formatSRTTime(start - startTimeForCut)} --> ${formatSRTTime(end - startTimeForCut)}\n`;
    srtContent += `${ayah.text}\n\n`;
});

fs.writeFileSync(srtPath, srtContent, 'utf-8');

const duration = endTimeForCut - startTimeForCut;

ffmpeg()
    .input(audioFile.path)
    .inputOptions([`-ss ${startTimeForCut}`, `-t ${duration}`]) // يقص الصوت الكبير على قد الآيات دي بالظبط
    .input('color=c=0x111827:s=1080x1920')
    .inputOptions(['-f lavfi'])
    // باقي الكود كما هو...
