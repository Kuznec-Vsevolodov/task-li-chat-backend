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

function getRandomFinalTask(tasks, user){
  tasks.sort(()=>Math.random()-0.5)
  console.log(tasks);
  console.log(user);
  if(tasks[0].passed == 1 && tasks[0].user == user){
    console.log(user);
    getRandomFinalTask(tasks, user)
  }else{
    return tasks[0].text;
  }
  // tasks.forEach((task) => {
  //   console.log(task);
  //   if(task.passed == 0 && task.user != user){
  //     console.log(task.text);
  //     var current_task = task.text;
  //     console.log(current_task)
  //     return current_task;
  //   }
  // })
}

function insertGameChanges(is_replay, chat_id, to, ex_user, loose_status, tasks, user, users, type, price, loosed_users){
  db.collection('game_chats').updateOne( {chat_id: chat_id} , { $set: { user_index: to, users: users, ex_user: ex_user, loose_status: loose_status, tasks: tasks, is_replay: is_replay, loosed_users: loosed_users} } );
  if(users.length != 1){
    io.to(user.room).emit('usersChanges', {users: users, user_index: to, price: price, tasks_replay: is_replay});
  }else if(type != 'sing'){
    io.to(user.room).emit('finalGame', {final_player: users[to]});
    db.collection('game_chats').updateOne( {chat_id: chat_id} , { $set: { is_final: true} } );
    var last_task = getRandomFinalTask(tasks, users[to]);
    io.to(user.room).emit('message', formatMessage(botName, `Пользователь ${users[to]} вступает в финальный раунд. Его цель - ответить на задание, из-за которого вылетел один из прошлых игроков. Задание таково: "${last_task}". Выполнение задания определяют другие пользователи`, user.room, "chatbot.png", false));
  }
  
  
}

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
    console.log('Всё заебись, база даже работает');
    // Ссылка на бд
    db = client.db('chats');
    queue_db = client.db('queue')

    // подключение к коллекциям
    chat_collection = db.collection('game_chats');
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

    socket.on('sendTask', ({task_text, chat_id}) => {
      const user = getCurrentUser(socket.id);
      var message_info = formatMessage(user.username, task_text, user.room, user.avatar, false);
      db.collection('game_chats').findOne({"chat_id": chat_id}, function(err, docs) {
        if (err){
          return res.sendStatus(500);
        }
        // добавление сообщений в базу
        docs.tasks.push({text: task_text, user: user.username, passed: null});
        
        docs.messages.push(message_info);
        db.collection('game_chats').updateOne( {chat_id: chat_id} , { $set: { tasks: docs.tasks, messages: docs.messages} } );
      });
      // отправка сообщения пользователям комнаты
      io.to(user.room).emit('message', message_info);
    });

    socket.on('partyResultHandler', ({value, chat_id}) => {
      
      const user = getCurrentUser(socket.id);

      chat_collection.findOne({"chat_id": chat_id}, function(err, result){
        if(err){ 
            console.log(err);
            return res.sendStatus(500);
        }
        console.log()
        if(result.is_final == false){
          var from_user = result.user_index;
          var ex_user = result.ex_user;
          var loose_status = result.loose_status;
          var users = result.users;
          var loosed_users = result.loosed_users;
          var to = 0;

          if(from_user < users.length-1){
            to = from_user + 1
          }

          if(value == 1){
            loose_status = 0;
            if(result.type == 'sing'){
              if(ex_user != null){
                io.to(user.room).emit('finalGameResult', {winner: true, user: result.users[ex_user], price: result.price});
              }else{
                io.to(user.room).emit('finalGameResult', {winner: true, user: result.users[to], price: result.price});
              }
            }else{
              if(ex_user != null){
                loosed_users.push(users[from_user]);
                users.splice(from_user, 1);
                ex_user = null;
                if(from_user > users.length - 1){
                  from_user = 0
                }
                  insertGameChanges(false, chat_id, from_user, ex_user, loose_status, result.tasks, user, users, result.type, result.price, loosed_users);
                  return('ok')
              }
  
              if(from_user < users.length-1){
                to = from_user + 1
              }
              result.tasks[result.tasks.length-1].passed = 1;
              ex_user = null;
              insertGameChanges(false, chat_id, to, ex_user, loose_status, result.tasks, user, users, result.type, result.price, loosed_users);
              return('ok')
            }
           
          }else if(value == 0){
            if(loose_status == 1){
              loose_status = 0;
              loosed_users.push(users[ex_user]);
              users.splice(ex_user, 1);
              to = ex_user;
              ex_user = null;

              if(users.length == to){
                to = 0;  
              }
              if (result.type == 'sing'){
                io.to(user.room).emit('finalGameResult', {winner: false, user: result.users[result.user_index], price: result.price});
              }else{
                insertGameChanges(false, chat_id, to, ex_user, loose_status, result.tasks, user, users, result.type, result.price, loosed_users);
              }
              
              return('ok')
            }
            loose_status = 1;
            ex_user = from_user;

            from_user = to;
            result.tasks[result.tasks.length-1].passed = 0;
            insertGameChanges(true, chat_id, from_user, ex_user, loose_status, result.tasks, user, users, result.type, result.price, loosed_users)
          }
        }else if(result.is_final == true){
          if(value == 1){
            result.final_positive_score+=1;
          }else if(value == 0){
            result.final_negative_score+=1;
          }

          db.collection('game_chats').updateOne( {chat_id: chat_id} , { $set: { final_positive_score: result.final_positive_score, final_negative_score: result.final_negative_score} } );

          if(result.loosed_users.length <= result.final_negative_score + result.final_positive_score){
            var winner_defender = true;
            if(result.final_negative_score > result.final_positive_score){
              winner_defender = false;
            }else if(result.final_positive_score == result.final_negative_score){
              winner_defender = null;
            }
            io.to(user.room).emit('message', formatMessage(botName, `${result.users[result.user_index]} победил в игре, заработав при этом ${result.price}`, user.room, 'chatbot.png', false));
            io.to(user.room).emit('finalGameResult', {winner: winner_defender, user: result.users[result.user_index], price: result.price});
          }
          
        }

      });
      
    })

    // получение сообщений
    socket.on('chatMessage', ({msg, image}) => {
      // инициализация пользователя
      const user = getCurrentUser(socket.id);
      console.log(user.game_type)
      // создание сообщения
      var message_info = formatMessage(user.username, msg, user.room, user.avatar, image);
      // поиск сообщений в рамках БД чата
      console.log(user)
      db.collection('game_chats').findOne({"chat_id": message_info.chat_id}, function(err, docs) {
        if (err){
          return res.sendStatus(500);
        }
        // добавление сообщений в базу
        docs.messages.push(message_info);
        db.collection('game_chats').updateOne( {chat_id: message_info.chat_id} , { $set: { messages: docs.messages } } );
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
            users: [data.user1, req.body.username],
            user_index: 0,
            ex_user: null,
            loose_status: 0,
            type: 'sing',
            tasks: [],
            is_replay: false,
            price: req.body.price*2,
            is_final: false,
            loosed_users: [],
            final_positive_score: 0,
            final_negative_score: 0,
            chat_id: now.getTime()
          }

          chat_collection.insertOne(chat, function(err, chat_res){
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
            db.collection('game_chats').updateOne( {chat_id: message.chat_id} , { $set: { messages: chat_res.ops[0].messages } } );
            // удаление старой очереди  
            sing_queue_collection.remove({user1: data.user1})  
            return res.send({'queue_id': data._id, 'chat_id': chat_res.ops[0].chat_id}) 
          });  
        }
  })
});

app.post('/team-queue', function(req, res){
  // проверка на наличие очереди
  team_queue_collection.findOne({"price": req.body.price}, function(err, data){
        if (err){
          return res.sendStatus(500);
        }
        if(data == null){
          // создание очереди
          var queue = { 
            users: [req.body.username],
            price: req.body.price
          };
          team_queue_collection.insertOne(queue, function(err, result){
            if(err){
              return res.send(err)
            }
            // возврат данных
            return res.send({'queue_id': result.ops[0]._id, 'chat_id': 0}) 
          });
        }else{
          if(data.users.length == 4){
            // создание чата при наличии пользователя в очереди
             
            console.log(data.users);
            var now = new Date();
            var users_before_last = data.users;
            users_before_last = users_before_last;
            var users = data.users;
            users.push(req.body.username)
            var chat = {
              messages: [],
              users: users,
              user_index: 0,
              ex_user: null,
              loose_status: 0,
              type: 'team',
              tasks: [], 
              is_replay: false,
              price: req.body.price*5,
              is_final: false,
              loosed_users: [],
              final_positive_score: 0,
              final_negative_score: 0,
              chat_id: now.getTime()
            }

            chat_collection.insertOne(chat, function(err, chat_res){
              if(err){
                return res.send(err)
              }
              var message = {
                  author: "NoOne",
                  author_avatar: false,
                  text: "Users: "+users.join(', '),
                  image: false,
                  time: moment().format('h:mm a'),
                  chat_id: chat_res.ops[0].chat_id
              }
              chat_res.ops[0].messages.push(message);
              db.collection('game_chats').updateOne( {chat_id: message.chat_id} , { $set: { messages: chat_res.ops[0].messages } } );
              // удаление старой очереди  
              users.pop()
              console.log(users);
              team_queue_collection.remove({users: users}); 
              console.log( data._id) 
              return res.send({'queue_id': data._id, 'chat_id': chat_res.ops[0].chat_id}) 
            });  

          }else{
            var users = data.users;
            users.push(req.body.username)
            team_queue_collection.updateOne( {id: data.id} , { $set: { users: users } });
            console.log(data._id)
            return res.send({'queue_id': data._id, 'chat_id': 0}) 
          }
        }
  })
});

app.post('/getchat-data', function(req, res) {
  // получение данных о сообщении
  chat_collection.findOne({"chat_id": req.body.chat_id}, function(err, result){
          
    if(err){ 
        console.log(err);
        return res.sendStatus(500);
    }
    if(result == null){
      return res.sendStatus(500);
    }
    // отправка сообщений
    res.send(result)
  });
});
