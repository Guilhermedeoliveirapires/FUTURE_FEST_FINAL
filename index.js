require('dotenv').config(); // <--- ISSO É OBRIGATÓRIO AGORA

const express = require('express');
const MongoClient = require('mongodb').MongoClient;
const session = require('express-session');
const bcrypt = require('bcryptjs');
const methodOverride = require('method-override');
const cors = require('cors');
const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require('@google/generative-ai');
const MongoStore = require('connect-mongo');

const app = express();

// === PORTA DINÂMICA (OBRIGATÓRIO NO RENDER E VERCEL) ===
const porta = process.env.PORT || 3000;

// === VARIÁVEIS DE AMBIENTE (NUNCA MAIS HARDCODE) ===
const urlMongo = process.env.MONGO_URL;
const API_KEY = process.env.GEMINI_API_KEY;

if (!urlMongo || !API_KEY) {
    console.error('❌ MONGO_URL ou GEMINI_API_KEY não definidas nas variáveis de ambiente!');
    process.exit(1);
}

app.set('view engine', 'ejs');
app.set('views', __dirname + '/views');

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride('_method'));
app.use(cors());

// Sessão mais segura (funciona no Render, no Vercel ainda vai perder às vezes)
app.use(session({
    secret: process.env.SESSION_SECRET || 'segredo-super-seguro',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
        mongoUrl: process.env.MONGO_URL,
        collectionName: 'sessions',
        ttl: 14 * 24 * 60 * 60 // 14 dias
    }),
    cookie: { 
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 14 * 24 * 60 * 60 * 1000
    }
}));

app.use(express.static(__dirname + '/views'));

const nomeBanco = 'FUTURE_FEST';
const collectionContatos = 'contatos';
const collectionNewsletter = 'newsletter';

const MODEL_NAME = 'gemini-2.0-flash'; // gemini-2.0-flash ainda não existe publicamente (19/11/2025)

const GENERATION_CONFIG = {
    temperature: 0.8,
    topK: 1,
    topP: 1,
    maxOutputTokens: 2048,
};

const SAFETY_SETTINGS = [
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
];

let model = null;
let chat = null;

const contexto = `
Você é Vida Plena, uma inteligência artificial especializada em bem-estar físico e emocional.  
Seu papel é ajudar o usuário a montar rotinas de autocuidado, planos de atividades físicas, hábitos alimentares saudáveis e oferecer apoio emocional leve e motivador.  

**DIRETRIZES DE COMPORTAMENTO**

- Mantenha sempre um tom acolhedor, divertido e empático.  
- Evite responder ou se aprofundar em assuntos fora do tema de bem-estar geral, mas não diga explicitamente que não pode falar sobre isso.  
  - Em vez disso, reconduza naturalmente a conversa para temas relacionados à saúde, equilíbrio, motivação, hábitos ou autocuidado.  
  - Exemplo: se o usuário falar de trabalho, responda algo como:  
    “Entendo! Às vezes o trabalho pode ser bem puxado… quer que eu te ajude a equilibrar isso com uma rotina de descanso ou alimentação melhor?”  
- Nunca seja ríspida, fria ou negativa. Sempre demonstre interesse genuíno pelo bem-estar do usuário.  
- Utilize linguagem simples, empática e otimista. Suas respostas devem também ser formatadas para melhor visualização do usuário.  

**FLUXO DE CONVERSA**

- Faça de 5 a 8 perguntas para coletar informações necessárias antes de gerar um relatório ou plano personalizado.  
- Adapte a quantidade e o estilo das perguntas conforme o comportamento do usuário (mais diretas se ele for objetivo; mais acolhedoras se estiver desanimado ou inseguro).  
- As perguntas podem abranger:  
  - objetivos físicos (ex: ganho de massa, emagrecimento, disposição);  
  - alimentação;  
  - rotina diária;  
  - humor/emocional;  
  - tempo disponível e preferências de atividades.  

**ESTRUTURA DE RELATÓRIO (INTERNA)**

Use este modelo para armazenar as informações coletadas e gerar o resultado final.  
Não exiba esse formato ao usuário — ele serve apenas como base interna.

Exemplo de estrutura:
peso: 70  
peso_desejado: 65  
objetivo: melhorar disposição e saúde mental  
rotina_disponível: manhã e noite  
alimentação_atual: rica em carboidratos e poucos vegetais  
nível_de_energia: médio  
estado_emocional: um pouco ansioso  

Essas variáveis devem ser usadas para gerar o relatório final ou recomendações, com linguagem natural, como se fosse uma conversa real de acompanhamento.  

**EXEMPLO DE SAÍDA PARA O USUÁRIO**

Que legal, já entendi bem o seu perfil 💚  
Montando um plano leve pra você começar:  
- **Atividade física**: 20 min de caminhada leve 3x por semana, depois vamos aumentando.  
- **Alimentação**: incluir mais frutas no café da manhã e reduzir refrigerantes.  
- **Emocional**: reserve 10 min diários pra algo que te acalme — pode ser música ou respiração guiada.  

Como se sente com esse começo?
`;

async function inicializarChat() {
    try {
        const genAI = new GoogleGenerativeAI(API_KEY);
        model = genAI.getGenerativeModel({ model: MODEL_NAME });
        
        chat = await model.startChat({
            generationConfig: GENERATION_CONFIG,
            safetySettings: SAFETY_SETTINGS,
            history: [{ role: 'user', parts: [{ text: contexto }] }],
        });
        console.log('Chat inicializado com sucesso.');
    } catch (error) {
        console.error('Erro ao inicializar Gemini:', error);
    }
}

inicializarChat();


app.get('/home', async (req, res) => {
    let usuario = null;
    let imagemPerfil = null;

    if (req.session.usuario) {
        const cliente = new MongoClient(urlMongo, { useUnifiedTopology: true });
        try {
            await cliente.connect();
            const banco = cliente.db(nomeBanco);
            const usuarios = banco.collection('usuarios');
            const usuarioLogado = await usuarios.findOne({ nome: req.session.usuario });
            if (usuarioLogado) {
                usuario = usuarioLogado.nome;
                imagemPerfil = usuarioLogado.imagemPerfil || null;
            }
        } catch (erro) {
            console.error('Erro ao buscar usuário:', erro);
        } finally {
            await cliente.close();
        }
    }

    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.render('home', { usuario, imagemPerfil });
});


app.get('/verificar-sessao', async (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    
    if (req.session.usuario) {
        const cliente = new MongoClient(urlMongo, { useUnifiedTopology: true });
        try {
            await cliente.connect();
            const banco = cliente.db(nomeBanco);
            const usuarios = banco.collection('usuarios');
            const usuarioLogado = await usuarios.findOne({ nome: req.session.usuario });
            
            if (usuarioLogado) {
                return res.json({ 
                    logado: true, 
                    usuario: usuarioLogado.nome,
                    imagemPerfil: usuarioLogado.imagemPerfil || null
                });
            }
        } catch (erro) {
            console.error('Erro ao buscar usuário:', erro);
        } finally {
            await cliente.close();
        }
    }
    
    res.json({ logado: false });
});

app.get('/AI', (req, res) => res.sendFile(__dirname + '/views/AI.html'));
app.get('/planos', (req, res) => res.sendFile(__dirname + '/views/plano.html'));
app.get('/registro', (req, res) => res.sendFile(__dirname + '/views/Registro.html'));
app.get('/login', (req, res) => res.sendFile(__dirname + '/views/Login.html'));
app.get('/sobre', (req, res) => res.sendFile(__dirname + '/views/sobre.html'));
app.get('/privacidade', (req, res) => res.sendFile(__dirname + '/views/privacidade.html'));

app.post('/registro', async (req, res) => {
    const cliente = new MongoClient(urlMongo, { useUnifiedTopology: true });
    try {
        await cliente.connect();
        const banco = cliente.db(nomeBanco);
        const usuarios = banco.collection('usuarios');

        const emailExistente = await usuarios.findOne({ email: req.body.email });
        if (emailExistente) {
            return res.send(`
                <!DOCTYPE html>
                <html lang="pt-BR">
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>Erro no Registro - Vida Plena</title>
                    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
                    <style>
                        body { background: #f8f9fa; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
                    </style>
                </head>
                <body>
                    <div class="alert alert-danger alert-dismissible fade show" role="alert" style="max-width: 500px;">
                        <strong>E-mail já cadastrado!</strong> Este e-mail já está em uso. Tente fazer login ou use outro e-mail.
                        <button type="button" class="btn-close" data-bs-dismiss="alert" onclick="window.location.href='/registro'"></button>
                    </div>
                    <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"></script>
                    <script>
                        setTimeout(() => window.location.href = '/registro', 3000);
                    </script>
                </body>
                </html>
            `);
        }

   
        if (req.body.senha && req.body.senha.length < 6) {
            return res.send(`
                <!DOCTYPE html>
                <html lang="pt-BR">
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>Erro no Registro - Vida Plena</title>
                    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
                    <style>
                        body { background: #f8f9fa; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
                    </style>
                </head>
                <body>
                    <div class="alert alert-warning alert-dismissible fade show" role="alert" style="max-width: 500px;">
                        <strong>Senha muito curta!</strong> A senha deve ter pelo menos 6 caracteres.
                        <button type="button" class="btn-close" data-bs-dismiss="alert" onclick="window.location.href='/registro'"></button>
                    </div>
                    <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"></script>
                    <script>
                        setTimeout(() => window.location.href = '/registro', 3000);
                    </script>
                </body>
                </html>
            `);
        }

        const senhaCriptografada = await bcrypt.hash(req.body.senha, 10);

        await usuarios.insertOne({
            nome: req.body.nome,
            email: req.body.email,
            senha: senhaCriptografada,
            imagemPerfil: null,
            dataCriacao: new Date()
        });

        res.redirect('/login');
    } catch (erro) {
        console.error(erro);
        res.send(`
            <!DOCTYPE html>
            <html lang="pt-BR">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Erro no Registro - Vida Plena</title>
                <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
                <style>
                    body { background: #f8f9fa; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
                </style>
            </head>
            <body>
                <div class="alert alert-danger alert-dismissible fade show" role="alert" style="max-width: 500px;">
                    <strong>Erro ao registrar!</strong> Ocorreu um erro ao criar sua conta. Por favor, tente novamente.
                    <button type="button" class="btn-close" data-bs-dismiss="alert" onclick="window.location.href='/registro'"></button>
                </div>
                <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"></script>
                <script>
                    setTimeout(() => window.location.href = '/registro', 3000);
                </script>
            </body>
            </html>
        `);
    } finally {
        await cliente.close();
    }
});

app.post('/login', async (req, res) => {
    const cliente = new MongoClient(urlMongo, { useUnifiedTopology: true });
    try {
        await cliente.connect();
        const banco = cliente.db(nomeBanco);
        const usuarios = banco.collection('usuarios');

        const usuario = await usuarios.findOne({ email: req.body.email });

        if (usuario && await bcrypt.compare(req.body.senha, usuario.senha)) {
            req.session.usuario = usuario.nome;
            res.redirect('/bemvindo');
        } else {
            res.send(`
                <!DOCTYPE html>
                <html lang="pt-BR">
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>Erro no Login - Vida Plena</title>
                    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
                    <style>
                        body { background: #f8f9fa; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
                    </style>
                </head>
                <body>
                    <div class="alert alert-danger alert-dismissible fade show" role="alert" style="max-width: 500px;">
                        <strong>Erro ao fazer login!</strong> E-mail ou senha incorretos. Verifique suas credenciais e tente novamente.
                        <button type="button" class="btn-close" data-bs-dismiss="alert" onclick="window.location.href='/login'"></button>
                    </div>
                    <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"></script>
                    <script>
                        setTimeout(() => window.location.href = '/login', 3000);
                    </script>
                </body>
                </html>
            `);
        }
    } catch (erro) {
        console.error(erro);
        res.send(`
            <!DOCTYPE html>
            <html lang="pt-BR">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Erro no Login - Vida Plena</title>
                <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
                <style>
                    body { background: #f8f9fa; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
                </style>
            </head>
            <body>
                <div class="alert alert-danger alert-dismissible fade show" role="alert" style="max-width: 500px;">
                    <strong>Erro!</strong> Ocorreu um erro ao processar seu login. Por favor, tente novamente mais tarde.
                    <button type="button" class="btn-close" data-bs-dismiss="alert" onclick="window.location.href='/login'"></button>
                </div>
                <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"></script>
                <script>
                    setTimeout(() => window.location.href = '/login', 3000);
                </script>
            </body>
            </html>
        `);
    } finally {
        await cliente.close();
    }
});

function protegerRota(req, res, next) {
    if (req.session.usuario) next();
    else res.redirect('/login');
}

app.get('/pagamento', protegerRota, (req, res) => {
    res.sendFile(__dirname + '/views/pagamento.html');
});

app.get('/explorar', (req, res) => {
    res.sendFile(__dirname + '/views/explorar.html');
});


app.get('/perfil', protegerRota, (req, res) => {
    res.sendFile(__dirname + '/views/perfil.html');
});

app.get('/configuracoes', protegerRota, (req, res) => {
    res.sendFile(__dirname + '/views/configuracoes.html');
});

app.get('/bemvindo', protegerRota, (req, res) => {
    res.send(`
        <script>
            alert("Login efetuado com sucesso! Bem-vindo, ${req.session.usuario}!");
            window.location.href = "/home";
        </script>
    `);
});

app.get('/erro', (req, res) => {
    res.redirect('/login');
});

app.get('/sair', (req, res) => {
    req.session.destroy(err => {
        if (err) return res.send('Erro ao sair!');
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
        res.redirect('/login');
    });
});

app.get('/formulario', (req, res) => {
    res.sendFile(__dirname + '/views/contato.html');
});


app.post('/formulario', async (req, res) => {
    const cliente = new MongoClient(urlMongo, { useUnifiedTopology: true });
    try {
        await cliente.connect();
        const banco = cliente.db(nomeBanco);
        const collection = banco.collection(collectionContatos);

        const novoFormulario = {
            nomeUsuario: req.body.nomeUsuario,
            sobrenomeUsuario: req.body.sobrenomeUsuario,
            email: req.body.email,
            numTelefone: req.body.numTelefone,
            motivo: req.body.motivo,
            mensagem: req.body.mensagem,
            dataEnvio: new Date()
        };

        const resultado = await collection.insertOne(novoFormulario);
        console.log(`Mensagem salva com sucesso! ID: ${resultado.insertedId}`);

        res.send(`
            <script>
                alert("Mensagem enviada com sucesso! Obrigado pelo contato, ${req.body.nomeUsuario}.");
                window.location.href = "/formulario";
            </script>
        `);
    } catch (erro) {
        console.error('Erro ao enviar a mensagem:', erro);
        res.status(500).send('Erro ao enviar a mensagem. Por favor, tente novamente mais tarde.');
    } finally {
        await cliente.close();
    }
});

app.post('/api/chat', async (req, res) => {
    try {
        const { message } = req.body;
        if (!message) return res.status(400).json({ error: 'Mensagem vazia' });
        if (!chat) return res.status(500).json({ error: 'Chat não inicializado. Tente novamente mais tarde.' });

        const result = await chat.sendMessage(message);
        const respostaIA = result.response.text();
        res.json({ reply: respostaIA });
    } catch (erro) {
        console.error('Erro IA:', erro);
        res.status(500).json({ error: 'Erro ao gerar resposta da IA' });
    }
});


app.post('/api/chat/reset', async (req, res) => {
    try {
      
        await inicializarChat();
        res.json({ success: true, message: 'Contexto da IA reiniciado com sucesso' });
    } catch (erro) {
        console.error('Erro ao resetar contexto da IA:', erro);
        res.status(500).json({ error: 'Erro ao resetar contexto da IA' });
    }
});


app.get('/api/perfil', protegerRota, async (req, res) => {
    const cliente = new MongoClient(urlMongo, { useUnifiedTopology: true });
    try {
        await cliente.connect();
        const banco = cliente.db(nomeBanco);
        const usuarios = banco.collection('usuarios');

        const usuario = await usuarios.findOne({ nome: req.session.usuario });
        if (!usuario) {
            return res.status(404).json({ error: 'Usuário não encontrado' });
        }

        res.json({
            nome: usuario.nome,
            email: usuario.email,
            imagemPerfil: usuario.imagemPerfil || null
        });
    } catch (erro) {
        console.error('Erro ao buscar perfil:', erro);
        res.status(500).json({ error: 'Erro ao buscar dados do perfil' });
    } finally {
        await cliente.close();
    }
});


app.get('/api/configuracoes', protegerRota, async (req, res) => {
    const cliente = new MongoClient(urlMongo, { useUnifiedTopology: true });
    try {
        await cliente.connect();
        const banco = cliente.db(nomeBanco);
        const usuarios = banco.collection('usuarios');

        const usuario = await usuarios.findOne({ nome: req.session.usuario });
        if (!usuario) {
            return res.status(404).json({ error: 'Usuário não encontrado' });
        }

    
        const configuracoes = usuario.configuracoes || {
            notificacoesEmail: true,
            notificacoesPush: false,
            newsletterSemanal: true,
            perfilPublico: false,
            compartilharDados: true,
            idioma: 'pt-br',
            tema: 'light',
            timezone: 'America/Sao_Paulo'
        };

        res.json(configuracoes);
    } catch (erro) {
        console.error('Erro ao buscar configurações:', erro);
        res.status(500).json({ error: 'Erro ao buscar configurações' });
    } finally {
        await cliente.close();
    }
});


app.put('/api/configuracoes', protegerRota, async (req, res) => {
    const cliente = new MongoClient(urlMongo, { useUnifiedTopology: true });
    try {
        await cliente.connect();
        const banco = cliente.db(nomeBanco);
        const usuarios = banco.collection('usuarios');

        const usuario = await usuarios.findOne({ nome: req.session.usuario });
        if (!usuario) {
            return res.status(404).json({ error: 'Usuário não encontrado' });
        }

        await usuarios.updateOne(
            { nome: req.session.usuario },
            { $set: { configuracoes: req.body } }
        );

        res.json({ success: true, message: 'Configurações atualizadas com sucesso' });
    } catch (erro) {
        console.error('Erro ao atualizar configurações:', erro);
        res.status(500).json({ error: 'Erro ao atualizar configurações' });
    } finally {
        await cliente.close();
    }
});


app.delete('/api/conta', protegerRota, async (req, res) => {
    const cliente = new MongoClient(urlMongo, { useUnifiedTopology: true });
    try {
        await cliente.connect();
        const banco = cliente.db(nomeBanco);
        const usuarios = banco.collection('usuarios');

        const usuario = await usuarios.findOne({ nome: req.session.usuario });
        if (!usuario) {
            return res.status(404).json({ error: 'Usuário não encontrado' });
        }

       
        await usuarios.deleteOne({ nome: req.session.usuario });

        
        req.session.destroy((err) => {
            if (err) {
                console.error('Erro ao destruir sessão:', err);
                return res.status(500).json({ error: 'Erro ao excluir conta' });
            }

            res.json({ success: true, message: 'Conta excluída com sucesso' });
        });
    } catch (erro) {
        console.error('Erro ao excluir conta:', erro);
        res.status(500).json({ error: 'Erro ao excluir conta' });
    } finally {
        await cliente.close();
    }
});


app.put('/api/perfil', protegerRota, async (req, res) => {
    const cliente = new MongoClient(urlMongo, { useUnifiedTopology: true });
    try {
        await cliente.connect();
        const banco = cliente.db(nomeBanco);
        const usuarios = banco.collection('usuarios');

        const usuario = await usuarios.findOne({ nome: req.session.usuario });
        if (!usuario) {
            return res.status(404).json({ error: 'Usuário não encontrado' });
        }

        const { nome, email, imagemPerfil, senhaAtual, novaSenha } = req.body;

        
        if (email && email !== usuario.email) {
            const emailExistente = await usuarios.findOne({ email: email });
            if (emailExistente) {
                return res.status(400).json({ error: 'E-mail já está em uso por outro usuário' });
            }
        }

    
        if (senhaAtual && novaSenha) {
            const senhaCorreta = await bcrypt.compare(senhaAtual, usuario.senha);
            if (!senhaCorreta) {
                return res.status(400).json({ error: 'Senha atual incorreta' });
            }
            const senhaCriptografada = await bcrypt.hash(novaSenha, 10);
            await usuarios.updateOne(
                { nome: req.session.usuario },
                { $set: { senha: senhaCriptografada } }
            );
        }

       
        const atualizacao = {};
        if (nome) atualizacao.nome = nome;
        if (email) atualizacao.email = email;
        if (imagemPerfil !== undefined) atualizacao.imagemPerfil = imagemPerfil || null;

        if (Object.keys(atualizacao).length > 0) {
            await usuarios.updateOne(
                { nome: req.session.usuario },
                { $set: atualizacao }
            );

      
            if (nome && nome !== req.session.usuario) {
                req.session.usuario = nome;
            }
        }

        res.json({ success: true, message: 'Perfil atualizado com sucesso' });
    } catch (erro) {
        console.error('Erro ao atualizar perfil:', erro);
        res.status(500).json({ error: 'Erro ao atualizar dados do perfil' });
    } finally {
        await cliente.close();
    }
});


app.post('/newsletter', async (req, res) => {
    const cliente = new MongoClient(urlMongo, { useUnifiedTopology: true });
    try {
        await cliente.connect();
        const banco = cliente.db(nomeBanco);
        const collection = banco.collection(collectionNewsletter);

        const email = req.body.email;
        if (!email) {
            return res.status(400).json({ error: 'E-mail é obrigatório' });
        }

 
        let usuarioEmail = null;
        let usuarioNome = null;
        if (req.session.usuario) {
            const usuarios = banco.collection('usuarios');
            const usuarioLogado = await usuarios.findOne({ nome: req.session.usuario });
            if (usuarioLogado) {
                usuarioEmail = usuarioLogado.email;
                usuarioNome = usuarioLogado.nome;
            }
        }


        const emailExistente = await collection.findOne({ email: email });
        if (emailExistente) {
            return res.status(200).json({ 
                success: true, 
                message: 'E-mail já está cadastrado na newsletter.',
                alreadyExists: true 
            });
        }

       
        const novoRegistro = {
            email: email,
            usuarioAssociado: usuarioNome || null,
            emailUsuarioAssociado: usuarioEmail || null,
            dataInscricao: new Date()
        };

        const resultado = await collection.insertOne(novoRegistro);
        console.log(`E-mail da newsletter registrado! ID: ${resultado.insertedId}, E-mail: ${email}, Usuário: ${usuarioNome || 'Não logado'}`);

        res.status(200).json({ 
            success: true, 
            message: 'E-mail registrado com sucesso na newsletter!' 
        });
    } catch (erro) {
        console.error('Erro ao registrar e-mail da newsletter:', erro);
        res.status(500).json({ error: 'Erro ao registrar e-mail. Por favor, tente novamente mais tarde.' });
    } finally {
        await cliente.close();
    }
});

app.listen(porta, '0.0.0.0', () => { 
    console.log(`Servidor rodando na porta ${porta}`);
    console.log(`Acesse: http://localhost:${porta}/home`);
});