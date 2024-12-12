import "dotenv/config"; //Récupération des variables d'environnement

//Import des fonctions externes
import express from "express";
import z from "zod";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";

//Import des fonctions internes
import { connectDb } from "./lib.js";
import { validateData, logger, checkAuth } from "./middleware.js";

//Initialisation
const app = express();
let db = await connectDb();

//#################### DEV ##########################


//## Gestion des utilisateurs
//Sign Up
const signupSchema = z.object({
    name: z.string().min(2),
    email: z.string().email(),
    password: z.string().min(8),
    role: z.string().min(2)
});
app.post("/auth/signup", express.json(), validateData(signupSchema), logger, async (req, res) => {
    const data = req.body;

    //Vérifier le rôle
    if(data.role != "formateur" && data.role != "etudiant"){
        res.status(400);
        res.json({ message: "The 'role' must be 'formateur' or 'etudiant'"});
        return;
    }

    //Vérifier que l'email n'est pas déja utilisé
    try{
        const [rows] = await db.query(
            "SELECT * FROM users WHERE email = ?",
            [data.email]
        );
        if(rows.length > 0){
            res.status(401);
            res.json({ message: "Unauthorized" });
            return;
        }
    }catch(error){
        res.status(500);
        res.json({ error: error.message });
        return;
    }

    //Ajouter l'utilisateur
    try {
      const hashedPassword = await bcrypt.hash(data.password, 10);
      const [result] = await db.execute(
        "INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)",
        [data.name, data.email, hashedPassword, data.role]
      );

      res.status(200);
      res.json({ id: result.insertId, name: data.name, email: data.email, role: data.role });
    } catch (error) {
      res.status(500);
      res.json({ error: error.message });
    }
    return;
});

//Login
const loginSchema = z.object({
    email: z.string().email(),
    password: z.string().min(8)
});
app.post("/auth/login", express.json(), validateData(loginSchema), logger, async (req, res) => {
    const data = req.body;

    //Vérifier l'existence de l'utilisateur et si le mot de passe est correct
    try{
        const [rows] = await db.query(
            "SELECT id, password, role FROM users WHERE email = ?",
            [data.email]
        );
        if (rows.length === 0) {
            res.status(401);
            res.send("Unauthorized");
            return;
        }
        const isRightPassword = await bcrypt.compare(
            data.password,
            rows[0].password
        );
        if (!isRightPassword) {
            res.status(401);
            res.send("Unauthorized");
            return;
        }
        //Génération du token avec l'Id et le rôle
        const payload = { id: rows[0].id, role: rows[0].role };
        const token = jwt.sign(payload, process.env.JWT_KEY);

        //Envoi du token
        res.status(200);
        res.json({ token });
    }catch(error){
        res.status(500);
        res.json({ error: error.message });
        return;
    }
    
    return;
});

//Vérifier et valider le token
app.get("/protected", logger, checkAuth, (req, res) => {
    res.status(200);
    res.send();
    return;
});




//## Gestion des sessions de cours
//Create session
const createSessionSchema = z.object({
    title: z.string().min(2),
    date: z.string().date()
});
app.post("/sessions", express.json(), validateData(createSessionSchema), logger, checkAuth, async (req, res) => {
    const data = req.body;
    const user_id = req.user.id;
    const user_role = req.user.role;

    //Vérifier que l'utilisateur existe et qu'il est bel et bien formateur
    if(user_role != "formateur"){
        res.status(401);
        res.json({ message: "Unauthorized, need -> role: 'formateur'" });
        return;
    }

    //Insertion de la session
    try{
        const [result] = await db.execute(
            "INSERT INTO sessions (title, date, formateur_id) VALUES (?, ?, ?)",
            [data.title, data.date, user_id]
        );
        res.status(200);
        res.json({ id: result.insertId, title: data.title, date: data.date, formateur_id: user_id });
    }catch(error){
        res.status(500);
        res.json({ error: error.message });
    }
    return;
});

//List sessions
app.get("/sessions", async (req, res) => {
    //Récupération de toutes les sessions
    try{
        let [rows] = await db.query("SELECT * FROM sessions");
        res.status(200);
        res.json(rows);
        return;
    }catch(error){
        res.status(500);
        res.json({ error: error.message });
        return;
    }
});

//Get specific session
app.get('/sessions/:id(\\d+)', async (req, res) => {
    //Récupération de l'id de la session dans l'url
    const id = parseInt(req.params.id);

    //Vérifier que la session existe et l'envoyer
    try{
        const [rows] = await db.query(
            "SELECT * FROM sessions WHERE id = ?", 
            [id]
        );
        if(rows.length === 0){
          res.status(404);
          res.send("Session not found");
          return;
        }
        res.status(200);
        res.json(rows[0]);
    }catch(error){
        res.status(500);
        res.json({ error: error.message });
    }
    
    return;
});

//Modify specific session
const modifySessionSchema = z.object({
    title: z.string().min(2),
    date: z.string().date()
});
app.put('/sessions/:id(\\d+)', express.json(), validateData(modifySessionSchema), logger, checkAuth, async (req, res) => {az
    const data = req.body;
    const id = parseInt(req.params.id);
    const user_id = req.user.id;
    const user_role = req.user.role;

    //Vérifier que l'utilisateur est bel et bien formateur
    if(user_role != "formateur"){
        res.status(401);
        res.json({ message: "Unauthorized, need -> role: 'formateur'" });
        return;
    }

    //Vérifier que la session existe et qu'elle appartient à l'utilisateur
    try{
        const [rows] = await db.query(
            "SELECT formateur_id FROM sessions WHERE id = ?", 
            [id]
        );
        if(rows.length === 0){
            res.status(404);
            res.send("Session not found");
            return;
        }
        if(rows[0].formateur_id != user_id){
            res.status(401);
            res.send("Not authorized");
            return;
        }
    }catch(error){
        res.status(500);
        res.json({ error: error.message });
        return;
    }
    
    //Modifier la session
    try{
        await db.query(
            "UPDATE sessions SET ? WHERE id = ?", 
            [{ title: data.title, date: data.date }, id]
        );
        res.status(200);
        res.send();
    }catch(error){
        res.status(500);
        res.json({ error: error.message });
    }
    
    return;
});

//Delete specific session
app.delete('/sessions/:id(\\d+)', logger, checkAuth, async (req, res) => {
    const id = parseInt(req.params.id);
    const user_id = req.user.id;
    const user_role = req.user.role;

    //Vérifier que l'utilisateur est bel et bien formateur
    if(user_role != "formateur"){
        res.status(401);
        res.json({ message: "Unauthorized, need -> role: 'formateur'" });
        return;
    }

    //Vérifier que la session existe et qu'elle appartient à l'utilisateur
    try{
        const [rows] = await db.query(
            "SELECT formateur_id FROM sessions WHERE id = ?", 
            [id]
        );
        if(rows.length === 0){
            res.status(404);
            res.send("Session not found");
            return;
        }
        if(rows[0].formateur_id != user_id){
            res.status(401);
            res.send("Not authorized");
            return;
        }
    }catch(error){
        res.status(500);
        res.json({ error: error.message });
        return;
    }
    
    //Supprimer la session
    try{
        await db.query(
            "DELETE FROM sessions WHERE id = ?", 
            [id]
        );
        res.status(200);
        res.send();
    }catch(error){
        res.status(500);
        res.json({ error: error.message });
    }

    return;
});





//## Gestion des émargements
//Student register
const registerToSessionSchema = z.object({
    presence: z.boolean()
});
app.post('/sessions/:id(\\d+)/emargement', express.json(), validateData(registerToSessionSchema), logger, checkAuth, async(req, res) => {
    const data = req.body;
    const id = parseInt(req.params.id);
    const user_id = req.user.id;
    const user_role = req.user.role;

    //Vérifier que l'utilisateur est bien étudiant
    if(user_role != "etudiant"){
        res.status(401);
        res.json({ message: "Unauthorized, need -> role: 'etudiant'" });
        return;
    }

    //Vérifier que la session existe
    try{
        const [rows] = await db.query(
            "SELECT * FROM sessions WHERE id = ?", 
            [id]
        );
        if(rows.length === 0){
            res.status(404);
            res.send("Session not found");
            return;
        }
    }catch(error){
        res.status(500);
        res.json({ error: error.message });
        return;
    }

    //Vérifier que l'étudiant n'est pas déja émargé à cette session
    try{
        const [result] = await db.query(
            "SELECT * FROM emargements WHERE etudiant_id = ? AND session_id = ?", 
            [user_id, id]
        );
        if(result.length > 0){
            res.status(401);
            res.json({ message: "The user is already suscribe to this session"});
            return;
        }
    }catch(error){
        res.status(500);
        res.json({ error: error.message });
    }


    //Emarger
    try{
        const [result] = await db.query(
            "INSERT INTO emargements (session_id, etudiant_id, status) VALUES (?, ?, ?)", 
            [id, user_id, data.presence]
        );
        res.status(200);
        res.json({ id: result.insertId, session_id: id, etudiant_id: user_id, presence: data.presence });
    }catch(error){
        res.status(500);
        res.json({ error: error.message });
    }
    return;
});

app.get('/sessions/:id(\\d+)/emargement', logger, checkAuth, async(req, res) => {
    const id = parseInt(req.params.id);
    const user_id = req.user.id;
    const user_role = req.user.role;

    //Vérifier que l'utilisateur est bien formateur
    if(user_role != "formateur"){
        res.status(401);
        res.json({ message: "Not authorized, need -> role: 'formateur'" });
        return;
    }

    //Vérifier que la session existe et qu'elle appartient bien à l'utilisateur
    try{
        const [rows] = await db.query(
            "SELECT * FROM sessions WHERE id = ?", 
            [id]
        );
        if(rows.length === 0){
            res.status(404);
            res.send("Session not found");
            return;
        }
        if(user_id != rows[0].formateur_id){
            res.status(401);
            res.send("Unauthorized");
            return;
        }
    }catch(error){
        res.status(500);
        res.json({ error: error.message });
        return;
    }

    //Récupérer les étudiants émargé à la session
    try{
        const [rows] = await db.query(
            "SELECT users.id, name, email, role, session_id, status FROM users INNER JOIN emargements ON users.id = emargements.etudiant_id WHERE session_id = ?",
            [id]
        );
        res.status(200);
        res.send(rows);
    }catch(error){
        res.status(500);
        res.json({ error: error.message });
    }
});


//#################### START-SERVER ##########################
//Démarrage du serveur
app.listen(3000, () => {
    console.log("Server is running on port 3000");
});