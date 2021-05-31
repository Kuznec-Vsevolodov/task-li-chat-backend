// подключение переменных и функций
const path = require('path');
const http = require('http');
const express = require('express');
const moment = require('moment');

const app = express();
const server = http.createServer(app);
const io = require('socket.io')(server);

const formatMessage = require('./utils/messages');
const {userJoin, getCurrentUser, userLeave, getRoomUsers} = require('./utils/users');

const mongoClient = require('mongodb').MongoClient;

const cors = require('cors');

// задача параметров приложения
app.use(express.static(path.join(__dirname, 'public')));
const bodyParser = require('body-parser');
app.use(bodyParser.json());
app.use(cors());

const botName = "Chat Bot";

const PORT = 3000 || process.env.PORT;

var db;
var team_collection;


mongoClient.connect(
  'mongodb://localhost:27017/',  // строка подключения
  {
     useUnifiedTopology: true,  // установка опций
     useNewUrlParser: true
  },
  function(err, client) {  // callback
    if (err) {
        return console.log("ОШИБКА");
    }
    // Ссылка на бд
    db = client.db('chats');
    queue_db = client.db('queue')

    // подключение к коллекциям
    team_collection = db.collection('team_chats');
    sing_collection = db.collection('sing_chats');
    team_queue_collection = queue_db.collection('team_queue')
    sing_queue_collection = queue_db.collection('sing_queue');

    // запуск сервера
    server.listen(PORT, console.log(`Сервер запущен по порту ${PORT}`));
});

io.on('connection', socket => {
    // запись человека в очередь
    socket.on('joinQueue', ({queue_id}) => {
      console.log("Подключился к очереди")
      console.log(queue_id)
      socket.join(queue_id);
    });
    // отправка данных в рамках комнаты очереди
    socket.on('queueMessage', ({queue_id, chat_id}) => {
      io.to(queue_id).emit('queue_message', chat_id);
    })

    // подключение к комнате чата
    socket.on('joinRoom', ({ username, room, avatar, game_type }) => {
      // создание пользователя и внесение
      const user = userJoin(socket.id, username, room, avatar, game_type);
      socket.join(user.room)
      // отправка сообщения пользователю
      socket.emit('message', formatMessage(botName, "Welcome to the chat", user.room, "chatbot.png", false));
    
      // групповое оповещение о подключении в рамках комнаты
      io.to(user.room).emit('message', formatMessage(botName, `A ${user.username} has joined the chat`, user.room, "chatbot.png", false));
    });

    // получение сообщений
    socket.on('chatMessage', ({msg, image}) => {
      // инициализация пользователя
      const user = getCurrentUser(socket.id);
      console.log(user.game_type)
      // создание сообщения
      var message_info = formatMessage(user.username, msg, user.room, user.avatar, image);
      // поиск сообщений в рамках БД чата
      db.collection(user.game_type+'_chats').findOne({"chat_id": message_info.chat_id}, function(err, docs) {
        if (err){
          return res.sendStatus(500);
        }
        // добавление сообщений в базу
        docs.messages.push(message_info);
        db.collection(user.game_type+'_chats').update( {chat_id: message_info.chat_id} , { $set: { messages: docs.messages } } );
      });
      // отправка сообщения пользователям комнаты
      io.to(user.room).emit('message', message_info);
    });

    // уведомление об отключении пользователя
    socket.on('disconnect', () => {
      // инициализация выхода пользователя
      const user = userLeave(socket.id);

      // отправка сообщения о выходе
      if(user){
        io.to(user.room).emit('message', formatMessage(botName, `A ${user.username} has left the chat`, user.room, 'chatbot.png', false));
      }

    });
});

app.post('/sing-queue', function(req, res){
  // проверка на наличие очереди
  sing_queue_collection.findOne({"price": req.body.price}, function(err, data){
        if (err){
          return res.sendStatus(500);
        }
        if(data == null){
          // создание очереди
          var queue = { 
            user1: req.body.username, 
            user2: '',
            price: req.body.price
          };
          sing_queue_collection.insertOne(queue, function(err, result){
            if(err){
              return res.send(err)
            }
            // возврат данных
            return res.send({'queue_id': result.ops[0]._id, 'chat_id': 0}) 
          });
        }else{
          // создание чата при наличии пользователя в очереди
          var now = new Date();
          var chat = {
            messages: [],
            user1: data.user1,
            user2: req.body.username,
            chat_id: now.getTime()
          }

          sing_collection.insertOne(chat, function(err, chat_res){
            if(err){
              return res.send(err)
            }
            var users = [data.user1, req.body.username]
            var message = {
                author: "NoOne",
                author_avatar: false,
                text: "Users: "+users.join(', '),
                image: false,
                time: moment().format('h:mm a'),
                chat_id: chat_res.ops[0].chat_id
            }
            chat_res.ops[0].messages.push(message);
            db.collection('sing_chats').update( {chat_id: message.chat_id} , { $set: { messages: chat_res.ops[0].messages } } );
            // удаление старой очереди  
            sing_queue_collection.remove({user1: data.user1})  
            return res.send({'queue_id': data._id, 'chat_id': chat_res.ops[0].chat_id}) 
          });  
        }
  })
});

app.post('/getchat-sing', function(req, res) {
  // получение данных о сообщении
  sing_collection.findOne({"chat_id": req.body.chat_id}, function(err, result){
          
    if(err){ 
        console.log(err);
        return res.sendStatus(500);
    }
    if(result == null){
      return res.sendStatus(500);
    }
    // отправка сообщений
    res.send(result.messages)
  });
});
