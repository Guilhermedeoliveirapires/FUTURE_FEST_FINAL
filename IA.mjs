import {
  GoogleGenerativeAI,
  HarmCategory,
  HarmBlockThreshold
} from '@google/generative-ai';
import chalk from 'chalk';
import ora from 'ora';
import prompt from 'prompt-sync';

const promptSync = prompt();
const MODEL_NAME = "gemini-2.0-flash";
const API_KEY = "AIzaSyB-59a4nJXgWMpdBFhbwCtP3wC0phYGyfw"; 

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

async function runChat() {
  const spinner = ora('Inicializando IA...').start();

  try {
    const genAI = new GoogleGenerativeAI(API_KEY);
    const model = genAI.getGenerativeModel({ model: MODEL_NAME });

    
    const contexto = `
Você é uma inteligência artificial chamada Vida Plena, especializada em bem-estar e rotina saudável.
Seu objetivo é conhecer o usuário, entender suas dificuldades e criar um plano de rotina.
Você deve fazer perguntas curtas e simpáticas, uma por vez, e adaptar o diálogo com base nas respostas.
Fale de forma acolhedora e natural.
    `;

    const chat = model.startChat({
      generationConfig: GENERATION_CONFIG,
      safetySettings: SAFETY_SETTINGS,
      history: [
        { role: "user", parts: [{ text: contexto }] },
      ],
    });

    spinner.stop();

   
    const introducao = `
    Olá! Eu sou o assistente virtual Vida Plena, seu guia para criar uma rotina leve, saudável e adaptada ao seu dia a dia.
    Com a ajuda da Inteligência Artificial Gemini, vou montar um plano personalizado para você, considerando seus hábitos, objetivos e bem-estar.

    Antes de começarmos, preciso saber um pouco mais sobre você. Vamos lá? 🌱
    O que você espera alcançar com uma rotina saudável?
    `;

    console.log(chalk.blue('AI:'), introducao);
    let resposta = promptSync(chalk.green('Você: '));

    
    let result = await chat.sendMessage(resposta);
    let respostaIA = result.response.text();
    console.log(chalk.blue('AI:'), respostaIA);

 
    const perguntas = [
      "Entendi! 😄 E quais áreas você gostaria de melhorar — sono, alimentação ou foco?",
      "Legal! Você costuma usar alguma ferramenta ou aplicativo para se organizar?",
      "Perfeito! Qual seria o seu principal objetivo para as próximas semanas?"
    ];

    
    for (const pergunta of perguntas) {
      console.log(chalk.blue('AI:'), pergunta);
      const resposta = promptSync(chalk.green('Você: '));

    
      const result = await chat.sendMessage(resposta);
      const respostaIA = result.response.text();
      console.log(chalk.blue('AI:'), respostaIA);
    }

    console.log(chalk.yellow('\nAgora podemos continuar conversando livremente! (Digite "exit" para sair.)'));

    while (true) {
      const userInput = promptSync(chalk.green('Você: '));
      if (userInput.toLowerCase() === 'exit') {
        console.log(chalk.yellow('Até breve! 🌱'));
        process.exit(0);
      }

      const result = await chat.sendMessage(userInput);
      const respostaIA = result.response.text();
      console.log(chalk.blue('AI:'), respostaIA);
    }

  } catch (error) {
    spinner.stop();
    console.error(chalk.red('❌ Erro encontrado:'), error.message);
    process.exit(1);
  }
}

runChat();