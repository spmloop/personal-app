// ตั้งค่า URL ของ Backend ที่นี่
// null      = ใช้ localStorage (GitHub Pages / โหมดออฟไลน์)
// ""        = ใช้ same-origin (รัน frontend จาก backend โดยตรง)
// "http://localhost:3001"          = รันในเครื่อง
// "https://your-app.railway.app"   = deploy บน cloud
window.__BACKEND__ = null;
