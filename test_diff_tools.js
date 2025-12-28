// Test file for diff editing tools
// This file contains sample code to test edit_block, apply_diff, and get_diff_preview

function calculateTotal(items) {
    return items.reduce((sum, item) => sum + item.price, 0);
}

function formatPrice(amount) {
    return "$" + amount.toFixed(2);
}

const CONFIG = {
    apiUrl: "https://api.example.com/v1",
    timeout: 5000,
    retries: 3
};

// This is a test function
function greet(name) {
    console.log("Hello, " + name);
}

// Multiple occurrences test
function add(a, b) { return a + b; }
function subtract(a, b) { return a - b; }
function multiply(a, b) { return a * b; }
