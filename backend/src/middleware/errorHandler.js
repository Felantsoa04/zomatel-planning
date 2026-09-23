// Gestionnaire d'erreurs centralise
function errorHandler(err, req, res, next) {
    console.error(err);
  
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'Cette valeur existe deja (doublon).' });
    }
    if (err.code === 'ER_NO_REFERENCED_ROW_2' || err.code === 'ER_ROW_IS_REFERENCED_2') {
      return res.status(409).json({ message: 'Operation impossible : reference liee invalide.' });
    }
  
    const status = err.status || 500;
    res.status(status).json({ message: err.message || 'Erreur serveur interne.' });
  }
  
  module.exports = errorHandler;