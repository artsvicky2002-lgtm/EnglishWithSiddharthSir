const express=require("express"),session=require("express-session"),bcrypt=require("bcryptjs"),Database=require("better-sqlite3"),multer=require("multer"),path=require("path"),fs=require("fs");
const app=express(),PORT=process.env.PORT||3000;
const db=new Database(process.env.DB_PATH||"site.db");
db.pragma("journal_mode=WAL");
if(!db) throw new Error('PostgreSQL mode requires the V8 production adapter; run with DATABASE_URL unset for local SQLite development.');
db.exec(`CREATE TABLE IF NOT EXISTS admins(id INTEGER PRIMARY KEY,username TEXT UNIQUE,password_hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS quizzes(id INTEGER PRIMARY KEY AUTOINCREMENT,title TEXT NOT NULL,category TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS questions(id INTEGER PRIMARY KEY AUTOINCREMENT,quiz_id INTEGER NOT NULL,question TEXT NOT NULL,a TEXT NOT NULL,b TEXT NOT NULL,c TEXT NOT NULL,d TEXT NOT NULL,correct TEXT NOT NULL,explanation TEXT,FOREIGN KEY(quiz_id) REFERENCES quizzes(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS notes(id INTEGER PRIMARY KEY AUTOINCREMENT,title TEXT NOT NULL,category TEXT NOT NULL,description TEXT,file TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS students(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS attempts(id INTEGER PRIMARY KEY AUTOINCREMENT,student_id INTEGER NOT NULL,quiz_id INTEGER NOT NULL,score INTEGER NOT NULL,total INTEGER NOT NULL,percentage REAL NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(student_id) REFERENCES students(id),FOREIGN KEY(quiz_id) REFERENCES quizzes(id));`);
if(!db.prepare("SELECT 1 FROM admins LIMIT 1").get()){
 const u=process.env.ADMIN_USER||"admin", p=process.env.ADMIN_PASSWORD||"ChangeMe_123!";
 db.prepare("INSERT INTO admins(username,password_hash) VALUES(?,?)").run(u,bcrypt.hashSync(p,12));
 console.log("Admin created. Change ADMIN_PASSWORD before production.");
}
app.use(express.json({limit:"1mb"}));app.use(express.urlencoded({extended:true}));
app.use(session({secret:process.env.SESSION_SECRET||"CHANGE_THIS_SESSION_SECRET",resave:false,saveUninitialized:false,cookie:{httpOnly:true,sameSite:"lax",secure:process.env.NODE_ENV==="production",maxAge:1000*60*60*8}}));
const uploads=path.join(__dirname,"uploads");fs.mkdirSync(uploads,{recursive:true});
const storage=multer.diskStorage({destination:uploads,filename:(req,file,cb)=>cb(null,Date.now()+"-"+file.originalname.replace(/[^a-zA-Z0-9._-]/g,"_"))});
const upload=multer({storage,limits:{fileSize:10*1024*1024},fileFilter:(req,f,cb)=>cb(null,/^(application\/pdf|image\/(png|jpeg|webp))$/.test(f.mimetype))});
const admin=(req,res,next)=>req.session.admin?next():res.status(401).json({error:"Unauthorized"});
app.use(express.static(path.join(__dirname,"public")));
app.use("/uploads",express.static(uploads));

app.post("/api/login",(req,res)=>{const a=db.prepare("SELECT * FROM admins WHERE username=?").get(req.body.username);if(!a||!bcrypt.compareSync(req.body.password,a.password_hash))return res.status(401).json({error:"Invalid username or password"});req.session.admin={id:a.id,username:a.username};res.json({ok:true,username:a.username})});
app.post("/api/logout",(req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get("/api/me",(req,res)=>res.json({authenticated:!!req.session.admin,username:req.session.admin?.username||null}));

app.get("/api/quizzes",(req,res)=>{const qs=db.prepare("SELECT * FROM quizzes ORDER BY id DESC").all();res.json(qs.map(q=>({...q,questions:db.prepare("SELECT id,question,a,b,c,d,correct,explanation FROM questions WHERE quiz_id=? ORDER BY id").all(q.id)})))});
app.post("/api/quizzes",admin,(req,res)=>{const {title,category,questions}=req.body;if(!title||!category||!Array.isArray(questions)||!questions.length)return res.status(400).json({error:"Incomplete quiz"});const tx=db.transaction(()=>{const r=db.prepare("INSERT INTO quizzes(title,category) VALUES(?,?)").run(title,category);const st=db.prepare("INSERT INTO questions(quiz_id,question,a,b,c,d,correct,explanation) VALUES(?,?,?,?,?,?,?,?)");questions.forEach(q=>st.run(r.lastInsertRowid,q.question,q.a,q.b,q.c,q.d,q.correct,q.explanation||""));return r.lastInsertRowid});res.json({id:tx()})});
app.put("/api/quizzes/:id",admin,(req,res)=>{const id=+req.params.id,{title,category,questions}=req.body;const tx=db.transaction(()=>{db.prepare("UPDATE quizzes SET title=?,category=? WHERE id=?").run(title,category,id);db.prepare("DELETE FROM questions WHERE quiz_id=?").run(id);const st=db.prepare("INSERT INTO questions(quiz_id,question,a,b,c,d,correct,explanation) VALUES(?,?,?,?,?,?,?,?)");questions.forEach(q=>st.run(id,q.question,q.a,q.b,q.c,q.d,q.correct,q.explanation||""));});tx();res.json({ok:true})});
app.delete("/api/quizzes/:id",admin,(req,res)=>{db.prepare("DELETE FROM questions WHERE quiz_id=?").run(+req.params.id);db.prepare("DELETE FROM quizzes WHERE id=?").run(+req.params.id);res.json({ok:true})});

app.get("/api/notes",(req,res)=>res.json(db.prepare("SELECT * FROM notes ORDER BY id DESC").all()));
app.post("/api/notes",admin,upload.single("file"),(req,res)=>{if(!req.file)return res.status(400).json({error:"Upload a PDF or image"});db.prepare("INSERT INTO notes(title,category,description,file) VALUES(?,?,?,?)").run(req.body.title,req.body.category,req.body.description||"",req.file.filename);res.json({ok:true})});
app.delete("/api/notes/:id",admin,(req,res)=>{const n=db.prepare("SELECT * FROM notes WHERE id=?").get(+req.params.id);if(n){try{fs.unlinkSync(path.join(uploads,n.file))}catch{}db.prepare("DELETE FROM notes WHERE id=?").run(n.id)}res.json({ok:true})});


const studentAuth=(req,res,next)=>req.session.student?next():res.status(401).json({error:"Student login required"});
app.post("/api/student/register",(req,res)=>{const {name,email,password}=req.body;if(!name||!email||!password||password.length<6)return res.status(400).json({error:"Name, email and 6+ character password required"});try{const r=db.prepare("INSERT INTO students(name,email,password_hash) VALUES(?,?,?)").run(name,email.toLowerCase(),bcrypt.hashSync(password,12));req.session.student={id:r.lastInsertRowid,name,email:email.toLowerCase()};res.json({ok:true})}catch(e){res.status(400).json({error:"Email already registered"})}});
app.post("/api/student/login",(req,res)=>{const a=db.prepare("SELECT * FROM students WHERE email=?").get((req.body.email||"").toLowerCase());if(!a||!bcrypt.compareSync(req.body.password,a.password_hash))return res.status(401).json({error:"Invalid email or password"});req.session.student={id:a.id,name:a.name,email:a.email};res.json({ok:true,name:a.name})});
app.post("/api/student/logout",(req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get("/api/student/me",(req,res)=>res.json({authenticated:!!req.session.student,student:req.session.student||null}));
app.post("/api/attempts",studentAuth,(req,res)=>{const {quizId,score,total}=req.body;if(!quizId||!Number.isInteger(score)||!Number.isInteger(total)||total<1||score<0||score>total)return res.status(400).json({error:"Invalid result"});const percentage=Math.round(score/total*10000)/100;db.prepare("INSERT INTO attempts(student_id,quiz_id,score,total,percentage) VALUES(?,?,?,?,?)").run(req.session.student.id,quizId,score,total,percentage);res.json({ok:true,percentage})});
app.get("/api/student/history",studentAuth,(req,res)=>res.json(db.prepare(`SELECT a.*,q.title,q.category FROM attempts a JOIN quizzes q ON q.id=a.quiz_id WHERE a.student_id=? ORDER BY a.id DESC`).all(req.session.student.id)));
app.get("/api/leaderboard",(req,res)=>res.json(db.prepare(`SELECT s.name,COUNT(a.id) attempts,ROUND(AVG(a.percentage),1) average,MAX(a.percentage) best FROM students s JOIN attempts a ON a.student_id=s.id GROUP BY s.id ORDER BY best DESC,average DESC LIMIT 50`).all()));
app.get("/api/admin/analytics",admin,(req,res)=>res.json({
students:db.prepare("SELECT COUNT(*) n FROM students").get().n,
attempts:db.prepare("SELECT COUNT(*) n FROM attempts").get().n,
avg:db.prepare("SELECT ROUND(AVG(percentage),1) n FROM attempts").get().n||0,
top:db.prepare(`SELECT s.name,q.title,a.score,a.total,a.percentage,a.created_at FROM attempts a JOIN students s ON s.id=a.student_id JOIN quizzes q ON q.id=a.quiz_id ORDER BY a.percentage DESC,a.id DESC LIMIT 10`).all()
}));


app.get("/api/student/dashboard",studentAuth,(req,res)=>{
 const attempts=db.prepare(`SELECT a.*,q.title,q.category,q.difficulty FROM attempts a JOIN quizzes q ON q.id=a.quiz_id WHERE a.student_id=? ORDER BY a.id DESC`).all(req.session.student.id);
 const total=attempts.length, avg=total?Math.round(attempts.reduce((x,a)=>x+a.percentage,0)/total*10)/10:0;
 const best=total?Math.max(...attempts.map(a=>a.percentage)):0;
 const categories={}; attempts.forEach(a=>{categories[a.category]=(categories[a.category]||[]).concat(a.percentage)});
 const categoryStats=Object.entries(categories).map(([category,v])=>({category,average:Math.round(v.reduce((a,b)=>a+b,0)/v.length*10)/10,attempts:v.length}));
 res.json({total,avg,best,categoryStats,attempts});
});
app.get("/api/daily-quiz",(req,res)=>{
 const rows=db.prepare("SELECT id,title,category,difficulty,duration,negative FROM quizzes ORDER BY id DESC").all();
 if(!rows.length)return res.json(null);
 const d=new Date(); const key=d.getUTCFullYear()+""+(d.getUTCMonth()+1)+""+d.getUTCDate();
 const idx=Array.from(key).reduce((a,c)=>a+c.charCodeAt(0),0)%rows.length;
 res.json(rows[idx]);
});

app.get("/api/health",(req,res)=>res.json({ok:true,environment:process.env.NODE_ENV||"development",database:usePostgres?"postgresql":"sqlite"}));
app.listen(PORT,()=>console.log("EnglishWithSiddharthSir V8 running on "+PORT));
