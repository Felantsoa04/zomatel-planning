require('dotenv').config();
const express = require('express');
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
const errorHandler = require('./middleware/errorHandler');


const app = express();

app.use(cors({
    origin: ['http://localhost:3000', 'http://localhost:3001'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }));
app.use(express.json());
app.use(morgan('dev'));




app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api/auth', authRoutes);
app.use('/api/services', serviceRoutes);
app.use('/api/employes', employeRoutes);
app.use('/api/plannings', planningRoutes);
app.use('/api/affectations', affectationRoutes);
app.use('/api/creneaux', creneauRoutes);
app.use('/api/types-horaires', typeHoraireRoutes);
app.use('/api/recuperations', recuperationRoutes);
app.use('/api/notifications', require('./routes/notificationRoutes'));

app.use((req, res) => res.status(404).json({ message: 'Route introuvable.' }));
app.use(errorHandler);

module.exports = app;