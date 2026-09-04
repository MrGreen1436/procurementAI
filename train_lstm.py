import pandas as pd
import numpy as np
import torch
import torch.nn as nn
from sklearn.preprocessing import MinMaxScaler
import joblib
import os

# Set random seed for reproducibility
torch.manual_seed(42)
np.random.seed(42)

# Parameters
SEQ_LENGTH = 14
HIDDEN_SIZE = 32
NUM_LAYERS = 2
EPOCHS = 100
LR = 0.01

class DemandLSTM(nn.Module):
    def __init__(self, input_size=1, hidden_size=HIDDEN_SIZE, num_layers=NUM_LAYERS, output_size=1):
        super(DemandLSTM, self).__init__()
        self.hidden_size = hidden_size
        self.num_layers = num_layers
        
        self.lstm = nn.LSTM(input_size, hidden_size, num_layers, batch_first=True)
        self.fc = nn.Linear(hidden_size, output_size)
        
    def forward(self, x):
        h0 = torch.zeros(self.num_layers, x.size(0), self.hidden_size).to(x.device)
        c0 = torch.zeros(self.num_layers, x.size(0), self.hidden_size).to(x.device)
        
        out, _ = self.lstm(x, (h0, c0))
        out = self.fc(out[:, -1, :])
        return out

def create_sequences(data, seq_length):
    xs = []
    ys = []
    for i in range(len(data)-seq_length):
        x = data[i:(i+seq_length)]
        y = data[i+seq_length]
        xs.append(x)
        ys.append(y)
    return np.array(xs), np.array(ys)

def train_model():
    print("Loading data...")
    df = pd.read_csv("demand_sample.csv")
    df['date'] = pd.to_datetime(df['date'])
    df = df.sort_values(by=['sku_id', 'date'])
    
    scalers = {}
    model = DemandLSTM()
    criterion = nn.MSELoss()
    optimizer = torch.optim.Adam(model.parameters(), lr=LR)
    
    all_x = []
    all_y = []
    
    print("Preparing sequences...")
    for sku in df['sku_id'].unique():
        sku_data = df[df['sku_id'] == sku]['demand'].values.reshape(-1, 1)
        
        scaler = MinMaxScaler(feature_range=(0, 1))
        sku_data_scaled = scaler.fit_transform(sku_data)
        scalers[sku] = scaler
        
        if len(sku_data_scaled) > SEQ_LENGTH:
            x, y = create_sequences(sku_data_scaled, SEQ_LENGTH)
            all_x.append(x)
            all_y.append(y)
        
    X_train = torch.tensor(np.vstack(all_x), dtype=torch.float32)
    y_train = torch.tensor(np.vstack(all_y), dtype=torch.float32)
    
    print(f"Training LSTM on {len(X_train)} samples...")
    model.train()
    for epoch in range(EPOCHS):
        optimizer.zero_grad()
        outputs = model(X_train)
        loss = criterion(outputs, y_train)
        loss.backward()
        optimizer.step()
        
        if (epoch+1) % 10 == 0:
            print(f'Epoch [{epoch+1}/{EPOCHS}], Loss: {loss.item():.4f}')
            
    print("Saving model and scalers...")
    torch.save(model.state_dict(), "lstm_model.pt")
    joblib.dump(scalers, "lstm_scalers.pkl")
    print("Done!")

if __name__ == "__main__":
    train_model()
