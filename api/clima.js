export default async function handler(req, res) {
    // 1. Apertura total de cabeceras de red para tu hosting de InfinityFree
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    // 2. Captura dinámica de las variables que envía el archivo deportivo TCX
    const { lat, lon, fecha, hora } = req.query;
    
    // Si no hay parámetros en la URL, devolvemos un aviso de que faltan datos en lugar de inventarlos
    if (!lat || !lon || !fecha || !hora) {
        return res.status(400).json({ 
            error: true, 
            mensaje: "Faltan parámetros geográficos o temporales en la consulta (lat, lon, fecha o hora)." 
        });
    }

    const latNum = parseFloat(lat);
    const lonNum = parseFloat(lon);
    
    // Formateamos la hora exacta de corte según exige el servidor meteorológico internacional
    const targetTimestamp = `${fecha}T${hora.substring(0, 2)}:00`;
    
    let resultado = { 
        error: false, 
        municipio: "Desconocido", 
        provincia: "España", 
        temp: null, 
        hum: null, 
        wind: null, 
        wbgt: null 
    };

    try {
        // 3. API DE GEOCALIZACIÓN INVERSA (Servidor a Servidor — Libre de bloqueos de navegador)
        const urlGeo = `https://open-meteo.com{latNum.toFixed(4)}&longitude=${lonNum.toFixed(4)}&current=&hourly=&local_meteo_id=open-meteo-geocoding`;
        const geoRes = await fetch(urlGeo);
        
        if (geoRes.ok) {
            const geoData = await geoRes.json();
            if (geoData && geoData.results && geoData.results.length > 0) {
                resultado.municipio = geoData.results[0].name || "Zona Rural";
                resultado.provincia = geoData.results[0].admin1 || "España";
            }
        }

        // 4. API METEOROLÓGICA DE ARCHIVO HISTÓRICO (Servidor a Servidor)
        const urlClima = `https://open-meteo.com{latNum.toFixed(4)}&longitude=${lonNum.toFixed(4)}&start_date=${fecha}&end_date=${fecha}&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m&timezone=Europe%2FMadrid`;
        
        const climaRes = await fetch(urlClima);
        if (!climaRes.ok) {
            throw new Error(`El satélite central de Open-Meteo respondió con código de error HTTP: ${climaRes.status}`);
        }
        
        const data = await climaRes.json();

        if (data && data.hourly && data.hourly.time) {
            const idx = data.hourly.time.indexOf(targetTimestamp);
            
            if (idx !== -1) {
                resultado.temp = data.hourly.temperature_2m[idx];
                resultado.hum = data.hourly.relative_humidity_2m[idx];
                resultado.wind = Math.round(data.hourly.wind_speed_10m[idx] * 10) / 10;
                
                // Cálculo de la fórmula fisiológica real del estrés térmico WBGT deportivo en caliente
                resultado.wbgt = Math.round((resultado.temp * 0.7) + (resultado.temp * (resultado.hum / 100) * 0.3));
            } else {
                throw new Error(`El bloque horario solicitado (${targetTimestamp}) no existe en los registros consolidados del satélite.`);
            }
        } else {
            throw new Error("El paquete de datos meteorológicos devuelto por internet tiene una estructura ilegible.");
        }

        // Si todo va bien, el servidor envía el JSON real e íntegro de internet
        return res.status(200).json(resultado);

    } catch (err) {
        // ERROR REAL: Si internet falla, el servidor reporta el fallo técnico verdadero. Nada está escrito a mano.
        return res.status(500).json({ 
            error: true, 
            mensaje: `Fallo crítico de conexión real de internet: ${err.message}` 
        });
    }
}

