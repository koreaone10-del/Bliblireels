export default function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
        // استبدل هذا برابط محرك الخادم الفعلي المرفوع على Render
        engineUrl: "https://bilireels-engine.onrender.com" 
    });
}
