# AS-113: Chat: chat.js probe budget accepts values above 2^31-1, which Node clamps to 1 ms — a budget of 2147483648 refuses a live server after 54 ms naming a budget it never spent (AS-83 Ruben F-1)
