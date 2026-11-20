async function testContextAwareChat() {
  try {
    console.log("--- 1. Register & Login ---");
    await fetch('http://127.0.0.1:5000/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: "chelsea_fan", password: "password123" })
    });

    const loginRes = await fetch('http://127.0.0.1:5000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: "chelsea_fan", password: "password123" })
    });
    const { token } = await loginRes.json();

    const sendMsg = async (msg) => {
      const res = await fetch('http://127.0.0.1:5000/api/chat/send/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ message: msg })
      });
      return await res.json();
    };

    console.log("\n--- 2. Sending First Message ---");
    const reply1 = await sendMsg("My favorite football team is Chelsea FC.");
    console.log("AI Reply 1:", reply1.response);

    console.log("\n--- 3. Sending Second Message (Testing Memory) ---");
    const reply2 = await sendMsg("Who is their manager right now?");
    console.log("AI Reply 2:", reply2.response);

  } catch (err) {
    console.error("Test failed:", err);
  }
}

testContextAwareChat();