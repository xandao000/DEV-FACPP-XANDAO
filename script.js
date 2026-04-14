/*
  script.js - Sistema de cotação da Faculdade Paulo Picanço
  Estrutura:
    - Constantes e estado global
    - Helpers de armazenamento e validação
    - Carregamento de dados locais e remotos
    - Inicialização da interface e gestão de tabs
    - Gestão de usuários, fornecedores e materiais
    - Funcionalidade de cotação, relatório e finalização
*/

// Chaves usadas no localStorage para armazenar dados do aplicativo
const STORAGE_KEYS = {
    EMPRESAS: 'db_empresas',
    MATERIAIS: 'db_materiais',
    COTACAO: 'db_cotacao',
    TIMESTAMP: 'db_cotacao_timestamp',
    FINALIZADAS: 'db_cotacoes_finalizadas',
    USUARIOS: 'db_usuarios',
    CURRENT_USER: 'db_current_user'
};

// Estado global em memória para o aplicativo
let empresas = [];
let materiais = [];
let cotacao = [];
let cotacoesFinalizadas = [];
let usuarios = [];
let currentUser = null;
let editingUserIndex = null;
let remoteAvailable = false;
let saveTimeout;
let lastSaveTime = Date.now();
const feedback = document.getElementById('feedback');
const API_DATA_URL = '/api/data';
const SYNC_STATUS = document.getElementById('saveIndicator');

// -----------------------------------------------------------------------------
// Helpers de armazenamento e validação
// -----------------------------------------------------------------------------

// Converte texto JSON em array com fallback seguro. Evita erros quando a string não é um JSON válido.
function safeJsonParse(item, fallback = []) {
    try {
        const parsed = JSON.parse(item);
        return Array.isArray(parsed) ? parsed : fallback;
    } catch {
        return fallback;
    }
}

// Retorna a chave correta do localStorage para dados específicos do usuário.
function getUserStorageKey(key) {
    if (key === STORAGE_KEYS.USUARIOS || key === STORAGE_KEYS.CURRENT_USER) {
        return key;
    }
    if (currentUser && currentUser.username) {
        return `${currentUser.username}_${key}`;
    }
    return key;
}

// Busca um item como array do localStorage e garante retorno em array.
function storageGetArray(key) {
    return safeJsonParse(localStorage.getItem(getUserStorageKey(key)), []);
}

// Busca um item JSON do localStorage e converte em objeto.
function storageGetObject(key, fallback = null) {
    try {
        const value = localStorage.getItem(getUserStorageKey(key));
        return value ? JSON.parse(value) : fallback;
    } catch {
        return fallback;
    }
}

// Busca um item textual simples do localStorage.
function storageGetString(key) {
    const value = localStorage.getItem(getUserStorageKey(key));
    return typeof value === 'string' ? value : '';
}

// Grava um valor JSON no localStorage de forma segura.
function storageSet(key, value) {
    try {
        localStorage.setItem(getUserStorageKey(key), JSON.stringify(value));
    } catch (error) {
        console.error('Falha ao salvar no localStorage:', error);
        showFeedback('Erro ao salvar dados no navegador.', 'error');
    }
}

// Grava um valor textual no localStorage.
function storageSetString(key, value) {
    try {
        localStorage.setItem(getUserStorageKey(key), value);
    } catch (error) {
        console.error('Falha ao salvar no localStorage:', error);
    }
}

// Remove espaços extras e garante string válida.
function normalizeString(value) {
    return typeof value === 'string' ? value.trim() : '';
}

// Valida e limpa os dados vindos do servidor antes de usar no aplicativo.
function validatePayload(payload) {
    const empresas = Array.isArray(payload.empresas)
        ? payload.empresas.map(normalizeString).filter(Boolean)
        : [];
    const materiais = Array.isArray(payload.materiais)
        ? payload.materiais.map(normalizeString).filter(Boolean)
        : [];
    const cotacao = Array.isArray(payload.cotacao)
        ? payload.cotacao.map(item => {
            if (typeof item !== 'object' || item === null) return null;
            const produto = normalizeString(item.produto);
            const qtd = Number.isFinite(Number(item.qtd)) && Number(item.qtd) > 0 ? Number(item.qtd) : 1;
            const valores = Array.isArray(item.valores)
                ? item.valores.map(v => (Number(v) >= 0 ? Number(v) : 0))
                : [];
            return produto || valores.some(v => v > 0) ? { produto, qtd, valores } : null;
        }).filter(Boolean)
        : [];
    const timestamp = normalizeString(payload.timestamp) || Date.now().toString();
    return { empresas, materiais, cotacao, timestamp };
}

// Formata timestamp para exibição legível no padrão brasileiro.
function formatTime(timestamp) {
    return new Date(Number(timestamp) || Date.now()).toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit'
    });
}

// Faz requisição HTTP e retorna JSON, ou null se o servidor não estiver disponível.
// Faz requisição HTTP e retorna o JSON da resposta.
// Retorna null quando a API não estiver disponível.
async function requestJson(path, options = {}) {
    try {
        const response = await fetch(path, options);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        console.warn('API unavailable:', error);
        return null;
    }
}

// -----------------------------------------------------------------------------
// Carregamento de dados locais e remotos
// -----------------------------------------------------------------------------

// Carrega a lista de fornecedores, materiais e cotação do armazenamento local.
function carregarDados() {
    empresas = storageGetArray(STORAGE_KEYS.EMPRESAS);
    materiais = storageGetArray(STORAGE_KEYS.MATERIAIS);
    cotacao = storageGetArray(STORAGE_KEYS.COTACAO);
    const timestamp = storageGetString(STORAGE_KEYS.TIMESTAMP);
    lastSaveTime = Number(timestamp) || lastSaveTime;
}

// Atualiza a mensagem de status de sincronização no cabeçalho da cotação.
function updateSyncIndicator(message, saving = false) {
    if (!SYNC_STATUS) return;
    SYNC_STATUS.textContent = message;
    SYNC_STATUS.classList.toggle('saving', !!saving);
}

// Tenta baixar dados remotos e atualiza o local se for mais recente.
async function carregarDadosRemotos() {
    const data = await requestJson(API_DATA_URL);
    if (!data) {
        updateSyncIndicator('Site indisponível, usando dados locais');
        return;
    }

    const remote = validatePayload(data);
    const remoteTimestamp = Number(remote.timestamp) || Date.now();
    const localTimestamp = Number(storageGetString(STORAGE_KEYS.TIMESTAMP)) || 0;

    if (remoteTimestamp > localTimestamp && remote.cotacao.length) {
        empresas = remote.empresas;
        materiais = remote.materiais;
        cotacao = remote.cotacao;
        storageSet(STORAGE_KEYS.EMPRESAS, empresas);
        storageSet(STORAGE_KEYS.MATERIAIS, materiais);
        storageSet(STORAGE_KEYS.COTACAO, cotacao);
        storageSetString(STORAGE_KEYS.TIMESTAMP, String(remoteTimestamp));
        lastSaveTime = remoteTimestamp;
        updateSyncIndicator(`Dados carregados do site às ${formatTime(lastSaveTime)}`);
    } else {
        updateSyncIndicator(localTimestamp
            ? `Dados locais carregados. Último sync às ${formatTime(localTimestamp)}`
            : 'Pronto para editar');
    }

    remoteAvailable = true;
}

async function saveRemoteData() {
    if (!remoteAvailable) {
        return false;
    }

    const payload = {
        empresas,
        materiais,
        cotacao,
        timestamp: Date.now().toString()
    };

    const result = await requestJson(API_DATA_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    if (result && result.success) {
        remoteAvailable = true;
        storageSetString(STORAGE_KEYS.TIMESTAMP, payload.timestamp);
        lastSaveTime = Number(payload.timestamp);
        return true;
    }

    remoteAvailable = false;
    return false;
}

// -----------------------------------------------------------------------------
// Inicialização da interface e evento de carregamento
// -----------------------------------------------------------------------------

// Configura os eventos, carrega dados iniciais e mostra a interface correta.
async function init() {
    carregarUsuarios();
    carregarDados();
    carregarFinalizadas();
    await carregarDadosRemotos();

    document.querySelectorAll('[data-tab]').forEach(button => {
        button.addEventListener('click', () => showTab(button.dataset.tab));
    });

    document.getElementById('formEmpresa').addEventListener('submit', event => {
        event.preventDefault();
        const nomeEmpresaInput = document.getElementById('nomeEmpresa');
        const nome = nomeEmpresaInput.value.trim();
        nomeEmpresaInput.value = '';
        nomeEmpresaInput.blur();
        cadastrarEmpresa(nome);
    });

    const formLogin = document.getElementById('formLogin');
    const btnLogout = document.getElementById('btnLogout');

    if (formLogin) {
        formLogin.addEventListener('submit', event => {
            event.preventDefault();
            const username = document.getElementById('loginUsuario').value.trim();
            const password = document.getElementById('loginSenha').value;
            login(username, password);
        });
    }

    if (btnLogout) {
        btnLogout.addEventListener('click', () => {
            logout();
        });
    }

    const btnNovoUsuario = document.getElementById('btnNovoUsuario');
    const btnCancelarUsuario = document.getElementById('btnCancelarUsuario');
    const formUsuario = document.getElementById('formUsuario');

    if (btnNovoUsuario) {
        btnNovoUsuario.addEventListener('click', () => abrirFormularioUsuario());
    }
    if (btnCancelarUsuario) {
        btnCancelarUsuario.addEventListener('click', fecharFormularioUsuario);
    }
    if (formUsuario) {
        formUsuario.addEventListener('submit', cadastrarUsuario);
    }
    const corpoUsuarios = document.getElementById('corpoUsuarios');
    if (corpoUsuarios) {
        corpoUsuarios.addEventListener('click', event => {
            const editar = event.target.closest('[data-edit-user]');
            const remover = event.target.closest('[data-remove-user]');
            if (editar) {
                const index = Number(editar.dataset.editUser);
                abrirFormularioUsuario(usuarios[index], index);
            }
            if (remover) {
                const index = Number(remover.dataset.removeUser);
                removerUsuario(index);
            }
        });
    }

    document.getElementById('formMaterial').addEventListener('submit', event => {
        event.preventDefault();
        const nomeMaterialInput = document.getElementById('nomeMaterial');
        const nome = nomeMaterialInput.value.trim();
        nomeMaterialInput.value = '';
        nomeMaterialInput.blur();
        cadastrarMaterial(nome);
    });

    document.getElementById('listaEmpresas').addEventListener('click', event => {
        const index = event.target.dataset.removeCompany;
        if (index !== undefined) {
            removerEmpresa(Number(index));
        }
    });

    document.getElementById('corpoMateriais').addEventListener('click', event => {
        const index = event.target.dataset.removeMaterial;
        if (index !== undefined) {
            removerMaterial(Number(index));
        }
    });

    const bodyCotacao = document.getElementById('bodyCotacao');

    bodyCotacao.addEventListener('click', event => {
        if (event.target.dataset.removeRow !== undefined) {
            event.target.closest('tr').remove();
            salvarCotacao(); // Salva imediatamente ao remover linha
            calcular();
        }
    });

    bodyCotacao.addEventListener('input', event => {
        if (event.target.matches('.preco, .qtd, .sel-mat')) {
            salvarCotacaoDebounced(); // Salva com debounce
            calcular();
        }
    });

    document.getElementById('btnAdicionarItem').addEventListener('click', adicionarLinha);
    document.getElementById('btnLimparCotacao').addEventListener('click', limparCotacao);
    document.getElementById('btnFinalizarCotacao').addEventListener('click', finalizarCotacao);
    document.getElementById('btnLimparFinalizadas').addEventListener('click', limparFinalizadas);
    document.getElementById('btnAtualizarGastos').addEventListener('click', renderGastosPeriodo);

    const periodoData = document.getElementById('periodoData');
    const periodoMes = document.getElementById('periodoMes');
    const periodoAno = document.getElementById('periodoAno');
    const hoje = new Date();

    if (periodoData) {
        periodoData.value = hoje.toISOString().slice(0, 10);
        periodoData.addEventListener('change', renderGastosPeriodo);
    }
    if (periodoMes) {
        periodoMes.value = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
        periodoMes.addEventListener('change', renderGastosPeriodo);
    }
    if (periodoAno) {
        periodoAno.value = hoje.getFullYear();
        periodoAno.addEventListener('change', renderGastosPeriodo);
    }

    document.getElementById('btnSalvarCotacao').addEventListener('click', () => {
        salvarCotacao();
        showTab('relatorio');
        showFeedback('Cotação salva e relatório atualizado.');
    });
    document.getElementById('btnSincronizarSite').addEventListener('click', async () => {
        updateSyncIndicator('Sincronizando com o site...', true);
        const success = await saveRemoteData();
        if (success) {
            showFeedback('Sincronização concluída com sucesso.');
        } else {
            showFeedback('Não foi possível sincronizar com o site.', 'error');
            updateSyncIndicator('Site indisponível, dados salvos localmente');
        }
    });
    document.getElementById('btnLimparFornecedores').addEventListener('click', limparFornecedores);
    document.getElementById('btnLimparMateriais').addEventListener('click', limparMateriais);
    document.getElementById('exportRelatorio').addEventListener('click', exportRelatorioAsDoc);

    renderEmpresas();
    renderMateriais();
    carregarCotacao();
    atualizarDashboard();
    if (currentUser) {
        showApp();
        showTab('dashboard');
    } else {
        showLogin();
    }

    // Salva automaticamente quando a página é fechada (apenas local)
    window.addEventListener('beforeunload', () => {
        const linhas = Array.from(document.querySelectorAll('.item-linha')).map(linha => {
            const produto = linha.querySelector('.sel-mat') ? linha.querySelector('.sel-mat').value : '';
            const qtd = parseFloat(linha.querySelector('.qtd').value) || 1;
            const valores = empresas.map((_, idx) => {
                const input = linha.querySelector(`.preco.p${idx}`);
                return input ? parseFloat(input.value) || 0 : 0;
            });
            return { produto, qtd, valores };
        }).filter(item => item.produto || item.valores.some(v => v > 0));

        cotacao = linhas;
        storageSet(STORAGE_KEYS.COTACAO, cotacao);
        storageSetString(STORAGE_KEYS.TIMESTAMP, Date.now().toString());
    });

    window.addEventListener('blur', () => {
        salvarCotacao();
    });
}

// -----------------------------------------------------------------------------
// Navegação entre abas
// -----------------------------------------------------------------------------

// Alterna a aba visível no painel lateral.
function showTab(tabName) {
    document.querySelectorAll('.tab-content').forEach(t => t.style.display = 'none');
    document.querySelectorAll('.nav-link').forEach(l => l.classList.toggle('active', l.dataset.tab === tabName));
    document.getElementById('tab-' + tabName).style.display = 'block';

    if (tabName === 'cotacao') {
        montarCabecalho();
        atualizarStatusCotacao();
    }
    if (tabName === 'relatorio') {
        gerarRelatorio();
    }
    if (tabName === 'finalizadas') {
        renderFinalizadas();
    }
    if (tabName === 'gastos') {
        renderGastosPeriodo();
    }
    if (tabName === 'dashboard') {
        renderDashboardCharts();
    }
    if (tabName === 'usuarios') {
        renderUsuarios();
    }

    atualizarDashboard();
}

// -----------------------------------------------------------------------------
// Feedback visual para o usuário
// -----------------------------------------------------------------------------

// Exibe uma mensagem de feedback rápida para o usuário.
function showFeedback(message, type = 'success') {
    feedback.textContent = message;
    feedback.className = `feedback feedback-${type}`;
    feedback.style.display = 'block';
    window.clearTimeout(showFeedback.timeout);
    showFeedback.timeout = window.setTimeout(() => {
        feedback.style.display = 'none';
    }, 3000);
}

// -----------------------------------------------------------------------------
// Gestão de usuários e autenticação
// -----------------------------------------------------------------------------

// Carrega todos os usuários existentes e o usuário atualmente logado.
function carregarUsuarios() {
    usuarios = storageGetArray(STORAGE_KEYS.USUARIOS);
    currentUser = storageGetObject(STORAGE_KEYS.CURRENT_USER, null);
}

// Salva a lista de usuários no localStorage.
function saveUsuarios() {
    storageSet(STORAGE_KEYS.USUARIOS, usuarios);
}

// Abre o formulário para criar ou editar um usuário.
function abrirFormularioUsuario(usuario = null, index = null) {
    editingUserIndex = index;
    const container = document.getElementById('userFormContainer');
    if (!container) return;
    container.style.display = 'block';

    document.getElementById('usuarioNome').value = usuario?.nome || '';
    document.getElementById('usuarioEmail').value = usuario?.email || '';
    document.getElementById('usuarioLogin').value = usuario?.username || '';
    document.getElementById('usuarioSenha').value = usuario?.password || '';
    document.getElementById('usuarioFuncao').value = usuario?.funcao || 'Solicitante';
    document.getElementById('usuarioMatricula').value = usuario?.matricula || '';
    document.getElementById('usuarioDepartamento').value = usuario?.departamento || '';
    document.getElementById('usuarioAtivo').checked = usuario?.ativo !== false;
}

// Fecha o formulário de usuário e limpa o estado de edição.
function fecharFormularioUsuario() {
    editingUserIndex = null;
    const container = document.getElementById('userFormContainer');
    if (!container) return;
    container.style.display = 'none';
    const form = document.getElementById('formUsuario');
    if (form) form.reset();
}

// Cria ou atualiza um usuário com validação simples.
function cadastrarUsuario(event) {
    event.preventDefault();
    const nome = document.getElementById('usuarioNome').value.trim();
    const email = document.getElementById('usuarioEmail').value.trim();
    const username = document.getElementById('usuarioLogin').value.trim();
    const password = document.getElementById('usuarioSenha').value;
    const funcao = document.getElementById('usuarioFuncao').value;
    const matricula = document.getElementById('usuarioMatricula').value.trim();
    const departamento = document.getElementById('usuarioDepartamento').value.trim();
    const ativo = document.getElementById('usuarioAtivo').checked;

    if (!nome || !email || !username || !password) {
        showFeedback('Preencha todos os campos obrigatórios.', 'error');
        return;
    }

    const existe = usuarios.some((u, idx) => u.username.toLowerCase() === username.toLowerCase() && idx !== editingUserIndex);
    if (existe) {
        showFeedback('Já existe um usuário com este login.', 'error');
        return;
    }

    const novoUsuario = {
        nome,
        email,
        username,
        password,
        funcao,
        matricula,
        departamento,
        ativo
    };

    if (editingUserIndex !== null && usuarios[editingUserIndex]) {
        usuarios[editingUserIndex] = novoUsuario;
        showFeedback('Usuário atualizado com sucesso.');
    } else {
        usuarios.push(novoUsuario);
        showFeedback('Usuário criado com sucesso.');
    }

    saveUsuarios();
    renderUsuarios();
    fecharFormularioUsuario();
}

// Atualiza a tabela de usuários exibida na aba de usuários.
function renderUsuarios() {
    const corpo = document.getElementById('corpoUsuarios');
    if (!corpo) return;

    if (!usuarios.length) {
        corpo.innerHTML = `<tr><td colspan="6" class="empty-state">Nenhum usuário cadastrado.</td></tr>`;
        return;
    }

    corpo.innerHTML = usuarios.map((usuario, idx) => `
        <tr>
            <td>${usuario.nome}</td>
            <td>${usuario.email}</td>
            <td>${usuario.funcao || 'Solicitante'}</td>
            <td>${usuario.matricula || '-'}</td>
            <td>${usuario.ativo ? 'Ativo' : 'Inativo'}</td>
            <td>
                <button type="button" class="btn-secondary" data-edit-user="${idx}">Editar</button>
                <button type="button" class="btn-secondary" data-remove-user="${idx}">Excluir</button>
            </td>
        </tr>
    `).join('');
}

// Remove um usuário após confirmação.
function removerUsuario(index) {
    if (!confirm('Deseja remover este usuário?')) return;
    usuarios.splice(index, 1);
    saveUsuarios();
    renderUsuarios();
}

// Define o usuário atual e recarrega dados específicos dele.
function setCurrentUser(user) {
    currentUser = user;
    if (user) {
        storageSet(STORAGE_KEYS.CURRENT_USER, user);
    } else {
        localStorage.removeItem(STORAGE_KEYS.CURRENT_USER);
        empresas = [];
        materiais = [];
        cotacao = [];
        cotacoesFinalizadas = [];
    }
    updateUserBar();
    carregarDados();
    carregarFinalizadas();
    renderEmpresas();
    renderMateriais();
    carregarCotacao();
    atualizarDashboard();
}

// Atualiza o texto de usuário logado no cabeçalho.
function updateUserBar() {
    const greeting = document.getElementById('userGreeting');
    if (greeting && currentUser) {
        greeting.textContent = `Usuário: ${currentUser.username}`;
    }
}

// Exibe somente a tela de login e oculta o restante do sistema.
function showLogin() {
    const loginScreen = document.getElementById('loginScreen');
    const sidebar = document.querySelector('.sidebar');
    const mainContent = document.querySelector('.main-content');
    if (loginScreen) loginScreen.style.display = 'flex';
    if (sidebar) sidebar.style.display = 'none';
    if (mainContent) mainContent.style.display = 'none';
}

// Exibe a interface principal após login bem-sucedido.
function showApp() {
    const loginScreen = document.getElementById('loginScreen');
    const sidebar = document.querySelector('.sidebar');
    const mainContent = document.querySelector('.main-content');
    if (loginScreen) loginScreen.style.display = 'none';
    if (sidebar) sidebar.style.display = 'block';
    if (mainContent) mainContent.style.display = 'block';
    updateUserBar();
}

// Verifica credenciais do usuário e faz login no sistema.
function login(username, password) {
    if (!username || !password) {
        showFeedback('Informe usuário e senha.', 'error');
        return;
    }
    const user = usuarios.find(u => u.username.toLowerCase() === username.toLowerCase());
    if (!user || user.password !== password) {
        showFeedback('Usuário ou senha inválidos.', 'error');
        return;
    }
    if (user.ativo === false) {
        showFeedback('Este usuário está inativo.', 'error');
        return;
    }
    setCurrentUser({ username: user.username });
    showApp();
    showTab('dashboard');
    showFeedback(`Bem-vindo, ${user.username}.`);
}

// Desloga o usuário e mostra a tela de login.
function logout() {
    setCurrentUser(null);
    showLogin();
}

// Adiciona um novo fornecedor, valida e atualiza a interface.
function cadastrarEmpresa(nome) {
    if (!nome.trim()) {
        showFeedback('Por favor, insira o nome do fornecedor.', 'error');
        return;
    }
    const nomeTrim = nome.trim();
    const existe = empresas.some(emp => emp.toLowerCase() === nomeTrim.toLowerCase());
    if (existe) {
        showFeedback('Este fornecedor já foi cadastrado.', 'error');
        return;
    }
    empresas.push(nomeTrim);
    storageSet('db_empresas', empresas);
    renderEmpresas();
    montarCabecalho();
    rebuildCotacao();
    atualizarDashboard();
    showFeedback('Fornecedor adicionado com sucesso.');
}

// Renderiza a lista de fornecedores cadastrados na interface.
function renderEmpresas() {
    const container = document.getElementById('listaEmpresas');
    if (empresas.length === 0) {
        container.innerHTML = '<p class="empty-state">Nenhum fornecedor cadastrado.</p>';
        return;
    }
    container.innerHTML = empresas.map((emp, i) => `
        <span class="chip">${emp} <button type="button" data-remove-company="${i}" aria-label="Remover ${emp}">×</button></span>
    `).join('');
}

// Remove um fornecedor cadastrado e atualiza todos os componentes relacionados.
function removerEmpresa(i) {
    empresas.splice(i, 1);
    storageSet('db_empresas', empresas);
    renderEmpresas();
    montarCabecalho();
    rebuildCotacao();
    atualizarDashboard();
    if (document.getElementById('tab-cotacao').style.display === 'block') {
        montarCabecalho();
        atualizarStatusCotacao();
    }
    showFeedback('Fornecedor removido.');
}

// -----------------------------------------------------------------------------
// Gestão de fornecedores e materiais
// -----------------------------------------------------------------------------

function cadastrarMaterial(nome) {
    if (!nome.trim()) {
        showFeedback('Por favor, insira o nome do material.', 'error');
        return;
    }
    const nomeTrim = nome.trim();
    const existe = materiais.some(mat => mat.toLowerCase() === nomeTrim.toLowerCase());
    if (existe) {
        showFeedback('Este material já foi cadastrado.', 'error');
        return;
    }
    materiais.push(nomeTrim);
    storageSet('db_materiais', materiais);
    renderMateriais();
    rebuildCotacao();
    atualizarDashboard();
    showFeedback('Material adicionado com sucesso.');
}

function renderMateriais() {
    const container = document.getElementById('corpoMateriais');
    if (materiais.length === 0) {
        container.innerHTML = '<tr><td colspan="2" class="empty-state">Nenhum material cadastrado.</td></tr>';
        return;
    }
    container.innerHTML = materiais.map((mat, i) => `
        <tr>
            <td>${mat}</td>
            <td><button type="button" class="btn-secondary" data-remove-material="${i}">Excluir</button></td>
        </tr>
    `).join('');
}

function removerMaterial(i) {
    materiais.splice(i, 1);
    storageSet('db_materiais', materiais);
    renderMateriais();
    rebuildCotacao();
    atualizarDashboard();
    if (document.getElementById('tab-cotacao').style.display === 'block') {
        atualizarStatusCotacao();
    }
    showFeedback('Material removido.');
}

// -----------------------------------------------------------------------------
// Operações na tabela de cotação
// -----------------------------------------------------------------------------

function adicionarLinha() {
    const body = document.getElementById('bodyCotacao');
    const tr = document.createElement('tr');
    tr.className = 'item-linha';
    tr.innerHTML = gerarLinhaCotacao('', 1, []);
    body.appendChild(tr);
    montarCabecalho();
    atualizarStatusCotacao();
    calcular();
    showFeedback('Linha de cotação adicionada.');
}

// Dispara o salvamento da cotação com debounce para evitar salvamentos muito frequentes.
function salvarCotacaoDebounced() {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
        salvarCotacao();
    }, 500); // Salva após 500ms sem mudanças
}

// Carrega a cotação atual do armazenamento e preenche a tabela.
function carregarCotacao() {
    const body = document.getElementById('bodyCotacao');
    body.innerHTML = '';
    cotacao.forEach(item => {
        const tr = document.createElement('tr');
        tr.className = 'item-linha';
        tr.innerHTML = gerarLinhaCotacao(item.produto, item.qtd, item.valores);
        body.appendChild(tr);
    });
    calcular();

    const timestamp = storageGetString(STORAGE_KEYS.TIMESTAMP);
    if (timestamp) {
        updateSyncIndicator(`Último salvamento: ${formatTime(timestamp)}`);
    }
}

// Reconstroi a tabela de cotação mantendo os dados atuais quando fornecedores ou materiais mudam.
function rebuildCotacao() {
    const body = document.getElementById('bodyCotacao');
    const linhas = Array.from(document.querySelectorAll('.item-linha')).map(linha => ({
        produto: linha.querySelector('.sel-mat') ? linha.querySelector('.sel-mat').value : '',
        qtd: parseFloat(linha.querySelector('.qtd').value) || 1,
        valores: Array.from(linha.querySelectorAll('.preco')).map(p => parseFloat(p.value) || 0)
    }));
    body.innerHTML = '';
    linhas.forEach(item => {
        const tr = document.createElement('tr');
        tr.className = 'item-linha';
        tr.innerHTML = gerarLinhaCotacao(item.produto, item.qtd, item.valores);
        body.appendChild(tr);
    });
    calcular();
}

// Atualiza a cotação quando a lista de materiais existentes é alterada.
function atualizarListaMateriaisExistentes() {
    if (document.getElementById('tab-cotacao').style.display === 'block') {
        rebuildCotacao();
        montarCabecalho();
        atualizarStatusCotacao();
    }
}

// Salva os dados da cotação atual no localStorage e tenta sincronizar com o servidor.
function salvarCotacao() {
    const linhas = Array.from(document.querySelectorAll('.item-linha')).map(linha => {
        const produto = linha.querySelector('.sel-mat') ? linha.querySelector('.sel-mat').value : '';
        const qtd = parseFloat(linha.querySelector('.qtd').value) || 1;
        const valores = empresas.map((_, idx) => {
            const input = linha.querySelector(`.preco.p${idx}`);
            return input ? parseFloat(input.value) || 0 : 0;
        });
        return { produto, qtd, valores };
    }).filter(item => item.produto || item.valores.some(v => v > 0));

    cotacao = linhas;
    storageSet(STORAGE_KEYS.COTACAO, cotacao);
    storageSetString(STORAGE_KEYS.TIMESTAMP, Date.now().toString());
    lastSaveTime = Date.now();
    updateSyncIndicator('Salvando localmente...', true);

    saveRemoteData().then(success => {
        if (success) {
            updateSyncIndicator(`Salvo no site às ${formatTime(lastSaveTime)}`);
        } else {
            updateSyncIndicator('Salvo localmente (site indisponível)');
        }
    });
}

// Atualiza os valores mostrados nos cards do dashboard.
function atualizarDashboardCards() {
    const qtdMateriais = materiais.length;
    const qtdFornecedores = empresas.length;
    const linhas = Array.from(document.querySelectorAll('.item-linha'));

    const linhasValidas = linhas.filter(linha => {
        const produto = linha.querySelector('.sel-mat')?.value || '';
        const precos = Array.from(linha.querySelectorAll('.preco')).map(p => parseFloat(p.value)).filter(v => !isNaN(v) && v > 0);
        return produto && precos.length > 0;
    });

    const itensCotados = linhasValidas.length;
    const precosVencedores = linhasValidas.map(linha => {
        const precos = Array.from(linha.querySelectorAll('.preco')).map(p => parseFloat(p.value) || Infinity);
        return Math.min(...precos);
    }).filter(v => v !== Infinity);

    const mediaPreco = precosVencedores.length ? precosVencedores.reduce((a, b) => a + b, 0) / precosVencedores.length : 0;
    const vencedorCount = {};

    linhasValidas.forEach(linha => {
        const precos = Array.from(linha.querySelectorAll('.preco')).map(p => parseFloat(p.value) || Infinity);
        const menor = Math.min(...precos);
        const indice = precos.indexOf(menor);
        if (indice >= 0 && menor !== Infinity) {
            const fornecedor = empresas[indice] || '-';
            vencedorCount[fornecedor] = (vencedorCount[fornecedor] || 0) + 1;
        }
    });

    const melhorFornecedor = Object.keys(vencedorCount).length
        ? Object.entries(vencedorCount).sort((a, b) => b[1] - a[1])[0][0]
        : '-';
    const ultimoFornecedor = empresas.length ? empresas[empresas.length - 1] : '-';
    const ultimoMaterial = materiais.length ? materiais[materiais.length - 1] : '-';

    document.getElementById('dash-qtd-mat').innerText = qtdMateriais;
    document.getElementById('dash-qtd-emp').innerText = qtdFornecedores;
    document.getElementById('dash-itens-cotados').innerText = itensCotados;
    document.getElementById('dash-media-preco').innerText = `R$ ${mediaPreco.toFixed(2)}`;
    document.getElementById('dash-melhor-fornecedor').innerText = melhorFornecedor;
    document.getElementById('dash-ultimo-fornecedor').innerText = ultimoFornecedor;
    document.getElementById('dash-ultimo-material').innerText = ultimoMaterial;
}

// Recalcula e atualiza todos os elementos visuais do dashboard.
function atualizarDashboard() {
    atualizarDashboardCards();
    calcular();
    renderDashboardCharts();
}

// Prepara dados de gastos mensais para os gráficos do dashboard.
function getDashboardMonthlyData() {
    const agora = new Date();
    const totals = {};

    cotacoesFinalizadas.forEach(cot => {
        const data = getFinalizadaDate(cot);
        const key = `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}`;
        totals[key] = (totals[key] || 0) + getTotalDeCotacao(cot);
    });

    const months = [];
    for (let index = 5; index >= 0; index--) {
        const date = new Date(agora.getFullYear(), agora.getMonth() - index, 1);
        const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        months.push({
            label: date.toLocaleString('pt-BR', { month: 'short' }),
            total: totals[key] || 0
        });
    }
    return months;
}

// Calcula os fornecedores mais comprados com base nas cotações finalizadas.
function getTopDentaisCompradas() {
    const totals = {};
    cotacoesFinalizadas.forEach(cot => {
        const fornecedores = cot.empresas || [];
        cot.itens.forEach(item => {
            if (!Array.isArray(item.valores)) return;
            item.valores.forEach((valor, idx) => {
                if (valor <= 0) return;
                const nome = fornecedores[idx] || `Fornecedor ${idx + 1}`;
                totals[nome] = (totals[nome] || 0) + (valor * (item.qtd || 1));
            });
        });
    });
    return Object.entries(totals)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([name, total]) => ({ name, total }));
}

// Desenha os gráficos simples de gastos e top fornecedores no dashboard.
function renderDashboardCharts() {
    const chartGastosMensais = document.getElementById('chartGastosMensais');
    const chartTopDentais = document.getElementById('chartTopDentais');
    if (!chartGastosMensais || !chartTopDentais) return;

    const meses = getDashboardMonthlyData();
    const maior = Math.max(...meses.map(m => m.total), 1);

    chartGastosMensais.innerHTML = `
        <div class="chart-bars">
            ${meses.map(m => `
                <div class="chart-bar">
                    <div class="chart-bar-fill" style="height: ${Math.max(6, Math.round((m.total / maior) * 100))}%;"></div>
                    <span class="chart-bar-value">R$ ${m.total.toFixed(0)}</span>
                    <span class="chart-bar-label">${m.label}</span>
                </div>
            `).join('')}
        </div>
    `;

    const topDentais = getTopDentaisCompradas();
    if (!topDentais.length) {
        chartTopDentais.innerHTML = '<p class="empty-state">Nenhum dental comprado ainda.</p>';
    } else {
        chartTopDentais.innerHTML = `
            <div class="chart-list">
                ${topDentais.map((item, index) => `
                    <div class="chart-item">
                        <span class="chart-item-name">${index + 1}. ${item.name}</span>
                        <span class="chart-item-total">R$ ${item.total.toFixed(2)}</span>
                    </div>
                `).join('')}
            </div>
        `;
    }
}

// Monta o cabeçalho da tabela de cotação conforme fornecedores cadastrados.
function montarCabecalho() {
    const head = document.getElementById('headCotacao');
    let html = '<tr><th>PRODUTO</th><th>QTD</th>';
    empresas.forEach(emp => {
        html += `<th colspan="2" class="company-column">${emp.toUpperCase()}</th>`;
    });
    html += '<th>MELHOR PREÇO</th></tr>';
    head.innerHTML = html;
}

// Limpa a cotação atual após confirmação do usuário.
function limparCotacao() {
    if (confirm('Tem certeza que deseja limpar toda a cotação?')) {
        document.getElementById('bodyCotacao').innerHTML = '';
        salvarCotacao();
        calcular();
        showFeedback('Cotação limpa com sucesso.');
    }
}

// Limpa todos os fornecedores cadastrados, mantendo a estrutura do app atualizada.
function limparFornecedores() {
    if (confirm('Tem certeza que deseja limpar todos os fornecedores?')) {
        empresas.length = 0;
        storageSet('db_empresas', empresas);
        renderEmpresas();
        montarCabecalho();
        rebuildCotacao();
        atualizarDashboard();
        if (document.getElementById('tab-cotacao').style.display === 'block') {
            montarCabecalho();
            atualizarStatusCotacao();
        }
        showFeedback('Todos os fornecedores foram removidos.');
    }
}

// Limpa todos os materiais cadastrados e atualiza a tabela de cotação.
function limparMateriais() {
    if (confirm('Tem certeza que deseja limpar todos os materiais?')) {
        materiais.length = 0;
        storageSet('db_materiais', materiais);
        renderMateriais();
        rebuildCotacao();
        atualizarDashboard();
        if (document.getElementById('tab-cotacao').style.display === 'block') {
            atualizarStatusCotacao();
        }
        showFeedback('Todos os materiais foram removidos.');
    }
}

// Limpa todos os dados do sistema com confirmação do usuário.
function resetCompleto() {
    if (confirm('ATENÇÃO: Isso irá limpar TODOS os dados (fornecedores, materiais e cotações). Esta ação não pode ser desfeita. Deseja continuar?')) {
        empresas.length = 0;
        materiais.length = 0;
        cotacao.length = 0;
        storageSet('db_empresas', empresas);
        storageSet('db_materiais', materiais);
        storageSet('db_cotacao', cotacao);
        renderEmpresas();
        renderMateriais();
        document.getElementById('bodyCotacao').innerHTML = '';
        atualizarDashboard();
        if (document.getElementById('tab-cotacao').style.display === 'block') {
            montarCabecalho();
            atualizarStatusCotacao();
        }
        showFeedback('Sistema resetado completamente.');
    }
}

// Gera o HTML de uma linha de cotação, incluindo select de material e campos de preço.
function gerarLinhaCotacao(produto = '', quantidade = 1, valores = []) {
    const options = materiais.length
        ? materiais.map(m => `<option value="${m}"${m === produto ? ' selected' : ''}>${m}</option>`).join('')
        : '<option value="">Nenhum material disponível</option>';

    const linhasPreco = empresas.map((_, idx) => {
        const valor = valores[idx] !== undefined ? valores[idx] : '';
        return `
            <td class="price-cell"><input type="number" class="preco p${idx}" min="0" step="0.01" value="${valor}" placeholder="Unit."></td>
            <td class="subtotal-emp s${idx}">R$ 0,00</td>
        `;
    }).join('');

    return `
        <td class="product-cell">
            <div class="row-actions">
                <select class="sel-mat">${options}</select>
                <button type="button" class="remove-row" data-remove-row="true" aria-label="Remover linha">×</button>
            </div>
        </td>
        <td><input type="number" class="qtd" min="1" value="${quantidade}"></td>
        ${linhasPreco}
        <td class="total-vencedor">R$ 0,00</td>
    `;
}

// Exibe mensagem de ajuda quando não há itens na cotação atual.
function atualizarStatusCotacao() {
    const btn = document.getElementById('btnAdicionarItem');
    const mensagem = document.getElementById('bodyCotacao');

    if (btn) {
        btn.disabled = false;
    }

    if (!document.querySelectorAll('.item-linha').length) {
        const message = empresas.length === 0
            ? 'Cadastre fornecedores para começar a adicionar itens.'
            : materiais.length === 0
                ? 'Cadastre materiais para começar a adicionar itens.'
                : 'Clique em + Novo Item para iniciar a cotação.';
        mensagem.innerHTML = `<tr><td colspan="${2 + empresas.length * 2 + 1}" class="empty-state">${message}</td></tr>`;
    }
}

// Calcula totais da cotação, destaca melhor preço e atualiza o dashboard.
function calcular() {
    let totalGeral = 0;
    document.querySelectorAll('.item-linha').forEach(linha => {
        const qtd = parseFloat(linha.querySelector('.qtd').value) || 0;
        const precos = Array.from(linha.querySelectorAll('.preco'));
        const valoresValidos = precos.map(p => parseFloat(p.value) || Infinity);
        const menorValor = Math.min(...valoresValidos);

        precos.forEach(input => {
            const unit = parseFloat(input.value) || 0;
            input.classList.toggle('vencedor', unit === menorValor && menorValor !== Infinity);
        });

        const totalLinha = menorValor !== Infinity ? menorValor * qtd : 0;
        linha.querySelector('.total-vencedor').innerText = `R$ ${totalLinha.toFixed(2)}`;
        totalGeral += totalLinha;
        precos.forEach((input, idx) => {
            const subtotalCell = linha.querySelector(`.subtotal-emp.s${idx}`);
            if (subtotalCell) {
                const unit = parseFloat(input.value) || 0;
                subtotalCell.innerText = `R$ ${unit > 0 ? (unit * qtd).toFixed(2) : '0,00'}`;
            }
        });
    });
    document.getElementById('dash-total').innerText = `R$ ${totalGeral.toFixed(2)}`;
    atualizarDashboardCards();
    salvarCotacao();
}

// -----------------------------------------------------------------------------
// Geração de relatórios e exportação
// -----------------------------------------------------------------------------

// Gera a tabela de relatório simples para a cotação atual.
function gerarRelatorio() {
    const corpo = document.getElementById('corpoRelatorio');
    const linhas = Array.from(document.querySelectorAll('.item-linha'));

    if (!linhas.length) {
        corpo.innerHTML = `<tr><td colspan="5" class="empty-state">Nenhuma cotação atual aberta. Finalize uma cotação ou use a aba de cotações finalizadas.</td></tr>`;
        return;
    }

    const itens = linhas.map(linha => {
        const produto = linha.querySelector('.sel-mat').value;
        const qtd = parseFloat(linha.querySelector('.qtd').value) || 0;
        const precos = Array.from(linha.querySelectorAll('.preco')).map(p => parseFloat(p.value) || Infinity);
        const menor = Math.min(...precos);
        const vencedor = precos.indexOf(menor);
        if (!produto || menor === Infinity || vencedor === -1) {
            return null;
        }
        return `
            <tr>
                <td>${produto}</td>
                <td>${empresas[vencedor] || '-'}</td>
                <td>R$ ${menor.toFixed(2)}</td>
                <td>${qtd}</td>
                <td>R$ ${(menor * qtd).toFixed(2)}</td>
            </tr>
        `;
    }).filter(Boolean);

    corpo.innerHTML = itens.length
        ? itens.join('')
        : `<tr><td colspan="5" class="empty-state">Nenhuma cotação válida foi encontrada. Verifique se todos os itens têm um produto e preço.</td></tr>`;
}

// Coleta os dados estruturados da cotação atual para exportação.
function getCotacaoData() {
    const linhas = Array.from(document.querySelectorAll('.item-linha'));
    return linhas.map(linha => {
        const produto = linha.querySelector('.sel-mat').value;
        const qtd = parseFloat(linha.querySelector('.qtd').value) || 0;
        const precos = empresas.map((empresa, idx) => {
            const input = linha.querySelector(`.preco.p${idx}`);
            const unitario = input ? parseFloat(input.value) || 0 : 0;
            return {
                empresa,
                unitario,
                total: unitario * qtd
            };
        });
        const melhor = precos.reduce((melhor, atual) => {
            if (atual.unitario > 0 && atual.unitario < melhor.unitario) return atual;
            return melhor;
        }, { empresa: '-', unitario: Infinity, total: 0 });
        return {
            produto,
            qtd,
            precos,
            melhorFornecedor: melhor.empresa === '-' ? '-' : melhor.empresa,
            melhorUnitario: melhor.unitario === Infinity ? 0 : melhor.unitario,
            melhorTotal: melhor.total
        };
    }).filter(item => item.produto && item.qtd > 0);
}

// Exporta a cotação atual como arquivo .doc usando HTML interno.
function exportRelatorioAsDoc() {
    const cotacoes = getCotacaoData();
    if (!cotacoes.length) {
        showFeedback('Nenhum item de cotação válido encontrado para exportar.', 'error');
        return;
    }

    const dataHora = new Date().toLocaleString('pt-BR');
    const headerRow1 = [`
        <th rowspan="2">Produto</th>
        <th rowspan="2">Quantidade</th>
    `];
    empresas.forEach(empresa => {
        headerRow1.push(`<th colspan="2">${empresa}</th>`);
    });
    headerRow1.push('<th rowspan="2">Melhor Fornecedor</th>', '<th rowspan="2">Melhor Total</th>');

    const headerRow2 = empresas.map(() => '<th>Unit.</th><th>Total</th>').join('');
    const cabecalho = `<tr>${headerRow1.join('')}</tr><tr>${headerRow2}</tr>`;

    const linhasHtml = cotacoes.map(item => {
        const precoCols = item.precos.map(preco => `
            <td>R$ ${preco.unitario.toFixed(2)}</td>
            <td>R$ ${preco.total.toFixed(2)}</td>
        `).join('');
        return `
            <tr>
                <td>${item.produto}</td>
                <td>${item.qtd}</td>
                ${precoCols}
                <td>${item.melhorFornecedor}</td>
                <td>R$ ${item.melhorTotal.toFixed(2)}</td>
            </tr>`;
    }).join('');

    const totalGeral = cotacoes.reduce((acc, item) => acc + item.melhorTotal, 0);
    const totalLinha = `
        <tr>
            <td colspan="${2 + empresas.length * 2}" style="font-weight:bold; text-align:right;">Total Geral</td>
            <td colspan="2" style="font-weight:bold;">R$ ${totalGeral.toFixed(2)}</td>
        </tr>`;

    const html = `
        <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
        <head>
            <meta charset="utf-8">
            <title>Relatório de Cotação</title>
            <style>
                * { margin: 0; padding: 0; }
                body { font-family: Arial, sans-serif; margin: 10mm; }
                .report-content { width: 100%; }
                h1 { font-size: 20px; margin-bottom: 2px; text-align: center; margin-top: 10px; }
                h2 { font-size: 13px; margin-top: 0; color: #333; text-align: center; margin-bottom: 8px; }
                p { margin: 4px 0; text-align: center; font-size: 12px; }
                strong { display: block; margin-top: 4px; text-align: center; font-size: 12px; }
                table { 
                    border-collapse: collapse; 
                    width: 100%; 
                    margin: 12px 0; 
                    font-size: 11px;
                }
                th, td { 
                    border: 1px solid #000; 
                    padding: 6px 4px; 
                    text-align: left; 
                }
                th { background: #ddd; font-weight: bold; }
                .report-header { margin-bottom: 12px; }
            </style>
        </head>
        <body>
            <div class="report-content">
                <div class="report-header">
                    <h1>Faculdade Paulo Picanço</h1>
                    <h2>Relatório de Cotação Detalhado</h2>
                    <p>Data de geração: ${dataHora}</p>
                    <strong>Total de itens: ${cotacoes.length}</strong>
                    <strong>Total de fornecedores: ${empresas.length}</strong>
                </div>
                <table>
                    ${cabecalho}
                    ${linhasHtml}
                    ${totalLinha}
                </table>
            </div>
        </body>
        </html>`;

    const blob = new Blob(['\ufeff', html], { type: 'application/msword' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'relatorio-cotacao.doc';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// -----------------------------------------------------------------------------
// Cotações finalizadas e histórico
// -----------------------------------------------------------------------------

// Carrega o histórico de cotações finalizadas do armazenamento.
function carregarFinalizadas() {
    cotacoesFinalizadas = storageGetArray(STORAGE_KEYS.FINALIZADAS);
}

// Finaliza a cotação atual salvando-a no histórico.
function finalizarCotacao() {
    const linhas = Array.from(document.querySelectorAll('.item-linha'));
    
    if (linhas.length === 0) {
        showFeedback('Nenhuma cotação para finalizar.', 'error');
        return;
    }

    const itensValidos = linhas.map(linha => {
        const produto = linha.querySelector('.sel-mat') ? linha.querySelector('.sel-mat').value : '';
        const qtd = parseFloat(linha.querySelector('.qtd').value) || 1;
        const valores = empresas.map((_, idx) => {
            const input = linha.querySelector(`.preco.p${idx}`);
            return input ? parseFloat(input.value) || 0 : 0;
        });
        return { produto, qtd, valores };
    }).filter(item => item.produto && item.valores.some(v => v > 0));

    if (itensValidos.length === 0) {
        showFeedback('A cotação deve ter pelo menos um item com preço para finalizar.', 'error');
        return;
    }

    const now = Date.now();
    const cotacaoFinalizada = {
        id: now,
        data: new Date(now).toLocaleString('pt-BR'),
        timestamp: now,
        itens: itensValidos,
        empresas: [...empresas],
        totalGeral: document.getElementById('dash-total').innerText
    };

    cotacoesFinalizadas.push(cotacaoFinalizada);
    storageSet(STORAGE_KEYS.FINALIZADAS, cotacoesFinalizadas);
    
    // Limpar cotação atual
    cotacao = [];
    storageSet(STORAGE_KEYS.COTACAO, cotacao);
    document.getElementById('bodyCotacao').innerHTML = '';
    
    atualizarDashboard();
    renderFinalizadas();
    showFeedback('Cotação finalizada e salva com sucesso!');
    showTab('finalizadas');
}

// Renderiza o painel de cotações finalizadas com ações de restaurar, excluir e exportar.
function renderFinalizadas() {
    const container = document.getElementById('listaFinalizadas');
    
    if (cotacoesFinalizadas.length === 0) {
        container.innerHTML = '<p class="empty-state">Nenhuma cotação finalizada.</p>';
        return;
    }

    let html = '';
    cotacoesFinalizadas.forEach((cot, idx) => {
        const itensHtml = cot.itens.map(item => {
            const precos = item.valores.map((v, i) => `${cot.empresas[i]}: R$ ${v.toFixed(2)}`).join(' | ');
            return `<div class="item-finalizado">
                <strong>${item.produto}</strong> (Qtd: ${item.qtd}) - ${precos}
            </div>`;
        }).join('');

        html += `
            <div class="card-cotacao-finalizada">
                <div class="cotacao-header">
                    <div>
                        <strong>Cotação #${cot.id}</strong>
                        <p class="cotacao-data">${cot.data}</p>
                    </div>
                    <div class="cotacao-actions">
                        <span class="total-cotacao">${cot.totalGeral}</span>
                        <button type="button" class="btn-secondary" onclick="restaurarCotacao(${idx})">Restaurar</button>
                        <button type="button" class="btn-secondary" onclick="deletarCotacaoFinalizada(${idx})">Excluir</button>
                        <button type="button" class="btn-secondary" onclick="exportarCotacaoFinalizada(${idx})">Exportar</button>
                    </div>
                </div>
                <div class="cotacao-itens">
                    ${itensHtml}
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
}

// Converte a data de uma cotação finalizada em objeto Date.
function getFinalizadaDate(cotacao) {
    if (typeof cotacao.timestamp === 'number') {
        return new Date(cotacao.timestamp);
    }
    if (typeof cotacao.timestamp === 'string' && !Number.isNaN(Number(cotacao.timestamp))) {
        return new Date(Number(cotacao.timestamp));
    }
    if (typeof cotacao.data === 'string') {
        const [datePart, timePart] = cotacao.data.split(' ');
        if (datePart) {
            const parts = datePart.split('/');
            if (parts.length === 3) {
                const [day, month, year] = parts.map(Number);
                const [hours = 0, minutes = 0, seconds = 0] = (timePart ? timePart.split(':').map(Number) : []);
                return new Date(year, month - 1, day, hours, minutes, seconds);
            }
        }
    }
    return new Date();
}

// Formata valores monetários no formato brasileiro.
function formatCurrency(value) {
    return `R$ ${value.toFixed(2)}`;
}

// Calcula o total de uma cotação finalizada, usando o menor preço por item.
function getTotalDeCotacao(cotacao) {
    return cotacao.itens.reduce((total, item) => {
        const menor = Math.min(...item.valores.filter(v => v > 0));
        if (!Number.isFinite(menor) || menor <= 0) return total;
        return total + menor * (item.qtd || 0);
    }, 0);
}

// -----------------------------------------------------------------------------
// Relatórios de gastos por período
// -----------------------------------------------------------------------------

// Calcula e exibe gastos por dia, mês e ano a partir das cotações finalizadas.
function renderGastosPeriodo() {
    const periodoData = document.getElementById('periodoData');
    const periodoMes = document.getElementById('periodoMes');
    const periodoAno = document.getElementById('periodoAno');

    const agora = new Date();
    const selecionadoDia = periodoData && periodoData.value ? periodoData.value : agora.toISOString().slice(0, 10);
    const selecionadoMes = periodoMes && periodoMes.value ? periodoMes.value : `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}`;
    const selecionadoAno = periodoAno && periodoAno.value ? String(periodoAno.value) : String(agora.getFullYear());

    let totalDia = 0;
    let totalMes = 0;
    let totalAno = 0;

    cotacoesFinalizadas.forEach(cot => {
        const data = getFinalizadaDate(cot);
        const cotacaoTotal = getTotalDeCotacao(cot);
        const dataIso = data.toISOString();
        const cotDia = dataIso.slice(0, 10);
        const cotMes = `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}`;
        const cotAno = `${data.getFullYear()}`;

        if (cotDia === selecionadoDia) totalDia += cotacaoTotal;
        if (cotMes === selecionadoMes) totalMes += cotacaoTotal;
        if (cotAno === selecionadoAno) totalAno += cotacaoTotal;
    });

    document.getElementById('gasto-dia').innerText = formatCurrency(totalDia);
    document.getElementById('gasto-mes').innerText = formatCurrency(totalMes);
    document.getElementById('gasto-ano').innerText = formatCurrency(totalAno);

    const corpo = document.getElementById('corpoGastosPeriodo');
    const rows = [
        { periodo: `Data: ${selecionadoDia}`, total: totalDia },
        { periodo: `Mês: ${selecionadoMes}`, total: totalMes },
        { periodo: `Ano: ${selecionadoAno}`, total: totalAno }
    ];

    corpo.innerHTML = rows.map(row => `
        <tr>
            <td>${row.periodo}</td>
            <td>${formatCurrency(row.total)}</td>
        </tr>
    `).join('');
}

// Restaura uma cotação finalizada para edição novamente.
function restaurarCotacao(idx) {
    if (cotacao.length > 0) {
        showFeedback('Você já possui uma cotação em aberto. Finalize ou limpe ela primeiro.', 'error');
        return;
    }

    const cotacaoRestaurada = cotacoesFinalizadas[idx];
    cotacao = [...cotacaoRestaurada.itens];
    storageSet(STORAGE_KEYS.COTACAO, cotacao);
    
    cotacoesFinalizadas.splice(idx, 1);
    storageSet(STORAGE_KEYS.FINALIZADAS, cotacoesFinalizadas);
    
    carregarCotacao();
    renderFinalizadas();
    showTab('cotacao');
    showFeedback('Cotação restaurada para edição.');
}

// Remove uma cotação finalizada do histórico após confirmação.
function deletarCotacaoFinalizada(idx) {
    if (confirm('Tem certeza que deseja excluir esta cotação finalizada?')) {
        cotacoesFinalizadas.splice(idx, 1);
        storageSet(STORAGE_KEYS.FINALIZADAS, cotacoesFinalizadas);
        renderFinalizadas();
        showFeedback('Cotação finalizada excluída.');
    }
}

// Exporta uma cotação finalizada para arquivo .doc.
function exportarCotacaoFinalizada(idx) {
    const cot = cotacoesFinalizadas[idx];
    const dataHora = cot.data;
    
    const headerRow1 = [`
        <th rowspan="2">Produto</th>
        <th rowspan="2">Quantidade</th>
    `];
    cot.empresas.forEach(empresa => {
        headerRow1.push(`<th colspan="2">${empresa}</th>`);
    });
    headerRow1.push('<th rowspan="2">Total</th>');

    const headerRow2 = cot.empresas.map(() => '<th>Unit.</th><th>Total</th>').join('');
    const cabecalho = `<tr>${headerRow1.join('')}</tr><tr>${headerRow2}</tr>`;

    const linhasHtml = cot.itens.map(item => {
        const precoCols = item.valores.map(valor => {
            const unitario = valor;
            const total = unitario * item.qtd;
            return `
                <td>R$ ${unitario.toFixed(2)}</td>
                <td>R$ ${total.toFixed(2)}</td>
            `;
        }).join('');
        
        const menorValor = Math.min(...item.valores);
        const totalLinha = menorValor * item.qtd;
        
        return `
            <tr>
                <td>${item.produto}</td>
                <td>${item.qtd}</td>
                ${precoCols}
                <td>R$ ${totalLinha.toFixed(2)}</td>
            </tr>`;
    }).join('');

    // Calcular totais por empresa
    const totaisPorEmpresa = cot.empresas.map((_, empIdx) => {
        return cot.itens.reduce((acc, item) => {
            return acc + (item.valores[empIdx] * item.qtd);
        }, 0);
    });

    const linhaSubtotalEmpresa = `
        <tr>
            <td colspan="2" style="font-weight:bold;">Total por Fornecedor:</td>
            ${totaisPorEmpresa.map(total => `
                <td colspan="2" style="font-weight:bold; text-align:right;">R$ ${total.toFixed(2)}</td>
            `).join('')}
            <td></td>
        </tr>
    `;

    const totalGeral = cot.itens.reduce((acc, item) => {
        const menorValor = Math.min(...item.valores);
        return acc + (menorValor * item.qtd);
    }, 0);

    const totalLinha = `
        <tr>
            <td colspan="${2 + cot.empresas.length * 2}" style="font-weight:bold; text-align:right;">Total Geral (Melhor Preço):</td>
            <td style="font-weight:bold;">R$ ${totalGeral.toFixed(2)}</td>
        </tr>`;

    const html = `
        <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
        <head>
            <meta charset="utf-8">
            <title>Cotação Finalizada</title>
            <style>
                * { margin: 0; padding: 0; }
                body { font-family: Arial, sans-serif; margin: 10mm; }
                .report-content { width: 100%; }
                h1 { font-size: 20px; margin-bottom: 2px; text-align: center; margin-top: 10px; }
                h2 { font-size: 13px; margin-top: 0; color: #333; text-align: center; margin-bottom: 8px; }
                p { margin: 4px 0; text-align: center; font-size: 12px; }
                strong { display: block; margin-top: 4px; text-align: center; font-size: 12px; }
                table { 
                    border-collapse: collapse; 
                    width: 100%; 
                    margin: 12px 0; 
                    font-size: 11px;
                }
                th, td { 
                    border: 1px solid #000; 
                    padding: 6px 4px; 
                    text-align: left; 
                }
                th { background: #ddd; font-weight: bold; }
                .report-header { margin-bottom: 12px; }
            </style>
        </head>
        <body>
            <div class="report-content">
                <div class="report-header">
                    <h1>Faculdade Paulo Picanço</h1>
                    <h2>Cotação Finalizada</h2>
                    <p>Data: ${dataHora}</p>
                    <strong>Total de itens: ${cot.itens.length}</strong>
                    <strong>Total de fornecedores: ${cot.empresas.length}</strong>
                </div>
                <table>
                    ${cabecalho}
                    ${linhasHtml}
                    ${linhaSubtotalEmpresa}
                    ${totalLinha}
                </table>
            </div>
        </body>
        </html>`;

    const blob = new Blob(['\ufeff', html], { type: 'application/msword' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cotacao-${cot.id}.doc`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showFeedback('Cotação exportada com sucesso.');
}

// Limpa todo o histórico de cotações finalizadas.
function limparFinalizadas() {
    if (confirm('Tem certeza que deseja limpar TODAS as cotações finalizadas? Esta ação não pode ser desfeita.')) {
        cotacoesFinalizadas = [];
        storageSet(STORAGE_KEYS.FINALIZADAS, cotacoesFinalizadas);
        renderFinalizadas();
        showFeedback('Todas as cotações finalizadas foram excluídas.');
    }
}

init();