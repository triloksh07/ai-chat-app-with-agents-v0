import cors from 'cors';
import 'dotenv/config';
import express from 'express';
import { apiKey } from './serverClient';

const app = express();
app.use(express.json());
app.use(cors({ origin: "*" })); // Allow requests from any origin // Change this in production for security

app.get("/", (req, res) => {
    res.json({
        message: "AI wirting Assistant server is running...",
        apiKey: apiKey,
    });
});

const port = process.env.PORT || 8080;
app.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`);
})