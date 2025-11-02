let cart = JSON.parse(localStorage.getItem("cart")) || [];

let cartOutput = document.getElementById("cart-output");
cartOutput.innerHTML = "";

if (cart.length === 0) {
  cartOutput.innerHTML = "<p>Cart is empty.</p>";
} else {
  cart.forEach(item => {
    let li = document.createElement("li");
    li.textContent = `${item.name} - ₱${item.price}`;
    cartOutput.appendChild(li);
  });
}

