const express = require('express');
const path = require('path');
const fs = require('fs').promises;

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');
const TEMP_DATA_FILE = DATA_FILE + '.tmp';

app.use(express.json({ limit: '1mb' }));
app.use(require('cors')());
app.use(express.static(__dirname));

function sanitizeString(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function sanitizeArray(value) {
    return Array.isArray(value) ? value.map(sanitizeString).filter(Boolean) : [];
}

function sanitizeCotacao(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.map(item => {
        if (typeof item !== 'object' || item === null) {
            return null;
        }
        const produto = sanitizeString(item.produto);
        const qtd = Number.isFinite(Number(item.qtd)) ? Number(item.qtd) : 1;
        const valores = Array.isArray(item.valores)
            ? item.valores.map(v => Number(v) >= 0 ? Number(v) : 0)
            : [];
        return produto || valores.some(v => v > 0) ? { produto, qtd, valores } : null;
    }).filter(Boolean);
}

async function ensureDataFile() {
    try {
        await fs.access(DATA_FILE);
    } catch {
        await writeData({ empresas: [], materiais: [], cotacao: [], timestamp: Date.now().toString() });
    }
}

async function readData() {
    try {
        await ensureDataFile();
        const raw = await fs.readFile(DATA_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        return {
            empresas: sanitizeArray(parsed.empresas),
            materiais: sanitizeArray(parsed.materiais),
            cotacao: sanitizeCotacao(parsed.cotacao),
            timestamp: sanitizeString(parsed.timestamp) || Date.now().toString()
        };
    } catch (error) {
        console.warn('Falha ao ler dados, retornando defaults:', error);
        return {
            empresas: [],
            materiais: [],
            cotacao: [],
            timestamp: Date.now().toString()
        };
    }
}

async function writeData(data) {
    const json = JSON.stringify(data, null, 2);
    await fs.writeFile(TEMP_DATA_FILE, json, 'utf8');
    await fs.rename(TEMP_DATA_FILE, DATA_FILE);
}

app.get('/api/data', async (req, res) => {
    const data = await readData();
    res.json(data);
});

app.get('/api/status', async (req, res) => {
    const data = await readData();
    res.json({ ok: true, timestamp: data.timestamp, remote: true });
});

app.post('/api/data', async (req, res) => {
    const payload = req.body || {};
    const validated = {
        empresas: sanitizeArray(payload.empresas),
        materiais: sanitizeArray(payload.materiais),
        cotacao: sanitizeCotacao(payload.cotacao),
        timestamp: sanitizeString(payload.timestamp) || Date.now().toString()
    };

    try {
        await writeData(validated);
        res.json({ success: true, timestamp: validated.timestamp });
    } catch (error) {
        console.error('Erro ao gravar arquivo:', error);
        res.status(500).json({ success: false, error: 'Falha ao salvar dados.' });
    }
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

if (!process.env.VERCEL) {
    app.listen(PORT, () => {
        console.log(`Servidor rodando em http://localhost:${PORT}`);
    });
}

module.exports = app;
