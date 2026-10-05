require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const morgan = require('morgan');

const authRoutes = require('./routes/authRoutes');
const serviceRoutes = require('./routes/serviceRoutes');
const employeRoutes = require('./routes/employeRoutes');
const planningRoutes = require('./routes/planningRoutes');
const affectationRoutes = require('./routes/affectationRoutes');
const creneauRoutes = require('./routes/creneauRoutes');
const typeHoraireRoutes = require('./routes/typeHoraireRoutes');
const recuperationRoutes = require('./routes/recuperationRoutes');
const messengerRoutes = require('./routes/messengerRoutes');
const errorHandler = require('./middleware/errorHandler');


const app = express();

app.use(cors({
    // Origines autorisées (développement local) : 3000/3001 (historiques)
    // + 3002 (frontend actuel). Aucune suppression des origines existantes.
    origin: ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:3002'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }));
app.use(express.json({ limit: '3mb' })); // marge au-dessus de la limite image (2 Mo)
app.use(morgan('dev'));




app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// Photos de profil (fichiers statiques, path safe : multer valide le type,
// les noms sont generes cote serveur). Servies depuis la racine :
// GET http://localhost:4000/uploads/profiles/<fichier>
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads'), {
  maxAge: '7d', // cache navigateur : les noms etant uniques (timestamp), pas de stale
}));

app.use('/api/auth', authRoutes);
app.use('/api/services', serviceRoutes);
app.use('/api/employes', employeRoutes);
app.use('/api/plannings', planningRoutes);
app.use('/api/affectations', affectationRoutes);
app.use('/api/creneaux', creneauRoutes);
app.use('/api/types-horaires', typeHoraireRoutes);
app.use('/api/recuperations', recuperationRoutes);
app.use('/api/messenger', messengerRoutes);
app.use('/api/notifications', require('./routes/notificationRoutes'));

app.use((req, res) => res.status(404).json({ message: 'Route introuvable.' }));
app.use(errorHandler);

module.exports = app;