# T2VTree (Local Demo)

This project is a visual platform for managing and executing AI image/video generation workflows. 
This version is the **Local Demo Edition**.

## Core Features

* **Visual Workflow**: Display all generation history as a tree diagram, with parent-child relationships between nodes clearly visible at a glance.
* **Node Details**: Click on a node card to view the Prompt used for that node's generation.
* **Video/Image Preview**: Click on a node's thumbnail to enlarge and preview.
* **Video Concatenation**: Add any node's result to a concatenation sequence and generate a new video.


### Step 1: Start the Backend (Python Flask)

1. Open a terminal and navigate to the `video_tree/backend/` directory.
    ```bash
    cd path/to/video_tree/backend
    ```
2. Start the backend server:
    ```bash
    python app.py
    ```

### Step 2: Start the Frontend (Vue.js)

1. Open a new terminal and navigate to the `video_tree/frontend/` directory.
    ```bash
    cd path/to/video_tree/frontend
    ```
2. Install Node.js dependencies:
    ```bash
    npm install
    ```
3. Start the frontend development server:
    ```bash
    npm run dev
    ```

### Step 3: Access the Application

Open your browser and visit:
`http://localhost:5173`

---

## How to Use

* **View Nodes**: After the page loads, you will see existing generation nodes from the database.

* **Generation**:
    1. Red: Audio generation workflow
    2. Blue: Image generation workflow
    3. Green: Video generation workflow
* **Video Concatenation**:
    1. Click the "☆" button on any node's thumbnail to add it to the concatenation bar below.
    3. Click the "stitching" button in the bottom-right corner of the concatenation bar, and the system will generate the concatenated video.
* **Workflow Storage Location**: `video_tree/backend/workflows`