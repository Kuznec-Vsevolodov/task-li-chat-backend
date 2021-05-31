const moment = require('moment');

function formatMessage(username, text, room, avatar, image) {
    return{
        author: username,
        author_avatar: avatar,
        text: text,
        image: image,
        time: moment().format('h:mm a'),
        chat_id: room
    }
}

module.exports = formatMessage